import os
import time
import threading
import logging
from typing import Any, Dict, List

import requests
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from web3 import Web3

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('backend.log')
    ]
)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logger.info(f"BASE_DIR: {BASE_DIR}")

logger.debug("Loading .env files...")
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, ".env.local"), override=True)
logger.debug("Environment loaded")

ALCHEMY_API_KEY = os.getenv("ALCHEMY_API_KEY", "").strip()
ALCHEMY_NFT_NETWORK = os.getenv("ALCHEMY_NFT_NETWORK", "eth-mainnet").strip()
COLLECTION_ADDRESS = os.getenv("COLLECTION_ADDRESS", "").strip().lower()

RPC_URL = os.getenv("ALCHEMY_URL", "").strip()
PRIVATE_KEY = os.getenv("PRIVATE_KEY", "").strip()
ORACLE_ADDRESS = os.getenv("ORACLE_REGISTRY_ADDRESS", os.getenv("ORACLE_PROXY_ADDRESS", "")).strip()
LOAN_ENGINE_ADDRESS = os.getenv("LOAN_ENGINE_ADDRESS", "").strip()

# Comma-separated token IDs, e.g. "1,2,3"
TOKEN_IDS = [int(x.strip()) for x in os.getenv("TOKEN_IDS", "1").split(",") if x.strip()]
TOKEN_QUANTITY = float(os.getenv("TOKEN_QUANTITY", "1"))
TOKEN_WEIGHTING = float(os.getenv("TOKEN_WEIGHTING", "1"))

UPDATE_INTERVAL_SECONDS = int(os.getenv("ORACLE_UPDATE_INTERVAL_SECONDS", "60"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "15"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "4"))

logger.info(f"ALCHEMY_API_KEY present: {bool(ALCHEMY_API_KEY)}")
logger.info(f"ALCHEMY_NFT_NETWORK: {ALCHEMY_NFT_NETWORK}")
logger.info(f"COLLECTION_ADDRESS: {COLLECTION_ADDRESS}")
logger.info(f"RPC_URL: {RPC_URL[:50]}..." if RPC_URL else "RPC_URL: NOT SET")
logger.info(f"ORACLE_ADDRESS: {ORACLE_ADDRESS}")
logger.info(f"LOAN_ENGINE_ADDRESS: {LOAN_ENGINE_ADDRESS}")
logger.info(f"TOKEN_IDS: {TOKEN_IDS}")
logger.info(f"UPDATE_INTERVAL_SECONDS: {UPDATE_INTERVAL_SECONDS}")

ORACLE_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "rightsId", "type": "uint256"},
            {"internalType": "uint256", "name": "value", "type": "uint256"},
        ],
        "name": "updateValue",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "rightsId", "type": "uint256"}],
        "name": "getLiquidationValue",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "rightsId", "type": "uint256"}],
        "name": "getRiskStatus",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "rightsId", "type": "uint256"}],
        "name": "getDynamicLTV",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "getEthUsdPriceE18",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

LOAN_ABI = [
    {
        "inputs": [{"internalType": "uint256", "name": "rightsId", "type": "uint256"}],
        "name": "outstandingDebt",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]

app = FastAPI()

state: Dict[str, Any] = {
    "last_oracle": {},
    "ltv": {},
    "risk": {},
    "alerts": [],
    "last_success_at": None,
    "last_error": None,
}

w3 = Web3(Web3.HTTPProvider(RPC_URL)) if RPC_URL else None
if w3:
    logger.info(f"Web3 initialized, connected: {w3.is_connected()}")
else:
    logger.warning("RPC_URL not set, Web3 not initialized")

account = w3.eth.account.from_key(PRIVATE_KEY) if w3 and PRIVATE_KEY else None
if account:
    logger.info(f"Account initialized: {account.address}")
else:
    logger.warning("PRIVATE_KEY not set or Web3 not available, account not initialized")

oracle_contract = (
    w3.eth.contract(address=w3.to_checksum_address(ORACLE_ADDRESS), abi=ORACLE_ABI)
    if w3 and ORACLE_ADDRESS
    else None
)
if oracle_contract:
    logger.info(f"Oracle contract initialized: {ORACLE_ADDRESS}")
else:
    logger.warning("ORACLE_ADDRESS not set or Web3 not available, oracle contract not initialized")

loan_contract = (
    w3.eth.contract(address=w3.to_checksum_address(LOAN_ENGINE_ADDRESS), abi=LOAN_ABI)
    if w3 and LOAN_ENGINE_ADDRESS
    else None
)
if loan_contract:
    logger.info(f"Loan contract initialized: {LOAN_ENGINE_ADDRESS}")
else:
    logger.warning("LOAN_ENGINE_ADDRESS not set or Web3 not available, loan contract not initialized")


def _http_get_json(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    logger.debug(f"HTTP GET: {url} with params: {params}")
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    result = response.json()
    logger.debug(f"HTTP GET response: {result}")
    return result


def _retry(operation_name: str, fn):
    logger.info(f"Starting retry-wrapped operation: {operation_name}")
    delay = 1.0
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = fn()
            logger.info(f"{operation_name} succeeded on attempt {attempt}")
            return result
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt == MAX_RETRIES:
                logger.error(f"{operation_name} failed on attempt {attempt} (final): {error}")
                break
            logger.warning(f"{operation_name} attempt={attempt} failed: {error}. retrying in {delay:.1f}s")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"{operation_name} failed after {MAX_RETRIES} retries: {last_error}")


def fetch_collection_floor_eth() -> float:
    if not ALCHEMY_API_KEY or not ALCHEMY_NFT_NETWORK or not COLLECTION_ADDRESS:
        logger.error("Missing Alchemy floor price config: ALCHEMY_API_KEY, ALCHEMY_NFT_NETWORK, COLLECTION_ADDRESS")
        raise RuntimeError("Missing Alchemy floor price config: ALCHEMY_API_KEY, ALCHEMY_NFT_NETWORK, COLLECTION_ADDRESS")

    url = f"https://{ALCHEMY_NFT_NETWORK}.g.alchemy.com/nft/v3/{ALCHEMY_API_KEY}/getFloorPrice"

    def _call() -> float:
        payload = _http_get_json(url, {"contractAddress": COLLECTION_ADDRESS})
        open_sea = payload.get("openSea", {}).get("floorPrice")
        looks_rare = payload.get("looksRare", {}).get("floorPrice")
        floor = open_sea if isinstance(open_sea, (float, int)) and open_sea > 0 else looks_rare
        if not isinstance(floor, (float, int)) or floor <= 0:
            logger.error(f"Alchemy floor price unavailable. openSea={open_sea}, looksRare={looks_rare}")
            raise RuntimeError("Alchemy floor price unavailable")
        logger.debug(f"Fetched floor price: {floor}")
        return float(floor)

    return _retry("fetch_collection_floor_eth", _call)


def fetch_eth_usd() -> float:
    # Public data source fallback for backend monitoring; on-chain pricing still uses Chainlink in OracleRegistry.
    url = "https://api.coingecko.com/api/v3/simple/price"

    def _call() -> float:
        payload = _http_get_json(url, {"ids": "ethereum", "vs_currencies": "usd"})
        value = payload.get("ethereum", {}).get("usd")
        if not isinstance(value, (float, int)) or value <= 0:
            raise RuntimeError("ETH/USD unavailable")
        return float(value)

    return _retry("fetch_eth_usd", _call)


def compute_nav_usd(floor_eth: float, quantity: float, weighting: float, eth_usd: float) -> float:
    return floor_eth * quantity * weighting * eth_usd


def push_floor_to_oracle(token_id: int, floor_eth: float):
    logger.info(f"Pushing floor price {floor_eth} ETH to oracle for token {token_id}")
    if not w3 or not account or not oracle_contract:
        logger.error("On-chain config missing for oracle push")
        raise RuntimeError("On-chain config missing for oracle push")

    value_wei = int(floor_eth * (10**18))
    logger.debug(f"Converted floor to wei: {value_wei}")

    def _push():
        try:
            nonce = w3.eth.get_transaction_count(account.address)
            logger.debug(f"Got nonce: {nonce}")
            
            tx = oracle_contract.functions.updateValue(token_id, value_wei).build_transaction(
                {
                    "from": account.address,
                    "chainId": w3.eth.chain_id,
                    "nonce": nonce,
                    "gas": 450000,
                    "maxFeePerGas": w3.to_wei("20", "gwei"),
                    "maxPriorityFeePerGas": w3.to_wei("2", "gwei"),
                }
            )
            logger.debug(f"Built transaction: {tx}")
            
            signed = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
            logger.debug(f"Signed transaction")
            
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            logger.info(f"Sent transaction: {w3.to_hex(tx_hash)}")
            
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            logger.debug(f"Got receipt: {receipt}")
            
            if receipt.status != 1:
                logger.error(f"Transaction reverted, status: {receipt.status}")
                raise RuntimeError("updateValue transaction reverted")
            
            logger.info(f"Transaction confirmed: {w3.to_hex(tx_hash)}")
            return w3.to_hex(tx_hash)
        except Exception as e:
            logger.error(f"Error in _push: {e}", exc_info=True)
            raise

    return _retry(f"push_floor_to_oracle:{token_id}", _push)


def refresh_ltv_and_risk(token_id: int):
    logger.info(f"Refreshing LTV and risk for token {token_id}")
    if not oracle_contract or not loan_contract:
        logger.warning("Contracts not available, skipping LTV/risk refresh")
        return

    try:
        liquidation_value = int(oracle_contract.functions.getLiquidationValue(token_id).call())
        dynamic_ltv = int(oracle_contract.functions.getDynamicLTV(token_id).call())
        risk_flag = bool(oracle_contract.functions.getRiskStatus(token_id).call())
        debt = int(loan_contract.functions.outstandingDebt(token_id).call())

        logger.debug(f"Token {token_id}: liquidation_value={liquidation_value}, dynamic_ltv={dynamic_ltv}, risk_flag={risk_flag}, debt={debt}")

        ltv_bps = int((debt * 10000) / liquidation_value) if liquidation_value > 0 else 10000

        state["ltv"][token_id] = {
            "tokenId": token_id,
            "debtWei": debt,
            "liquidationValueWei": liquidation_value,
            "ltvBps": ltv_bps,
            "dynamicLtvBps": dynamic_ltv,
            "updatedAt": int(time.time()),
        }

        status = "panic" if risk_flag or ltv_bps > dynamic_ltv else ("warning" if ltv_bps > int(dynamic_ltv * 0.85) else "normal")
        state["risk"][token_id] = {
            "tokenId": token_id,
            "riskFlag": risk_flag,
            "status": status,
            "ltvBps": ltv_bps,
            "dynamicLtvBps": dynamic_ltv,
            "updatedAt": int(time.time()),
        }

        logger.debug(f"Token {token_id}: LTV={ltv_bps/100:.2f}%, dynamic_ltv={dynamic_ltv/100:.2f}%, status={status}")

        if status == "panic":
            alert = {
                "tokenId": token_id,
                "message": f"Panic threshold breached (ltv={ltv_bps/100:.2f}%, limit={dynamic_ltv/100:.2f}%, oracleRisk={risk_flag})",
                "timestamp": int(time.time()),
            }
            logger.warning(f"[ALERT] {alert['message']}")
            state["alerts"].append(alert)
    except Exception as e:
        logger.error(f"Error refreshing LTV/risk for token {token_id}: {e}", exc_info=True)


def nav_loop_once():
    logger.info("=== Starting NAV loop iteration ===")
    
    try:
        logger.info("Fetching collection floor price...")
        floor_eth = fetch_collection_floor_eth()
        logger.info(f"Floor price: {floor_eth} ETH")
    except Exception as e:
        logger.error(f"Failed to fetch floor: {e}")
        raise
    
    try:
        logger.info("Fetching ETH/USD price...")
        eth_usd = fetch_eth_usd()
        logger.info(f"ETH/USD: ${eth_usd}")
    except Exception as e:
        logger.error(f"Failed to fetch ETH/USD: {e}")
        raise

    nav_usd = compute_nav_usd(floor_eth, TOKEN_QUANTITY, TOKEN_WEIGHTING, eth_usd)
    logger.info(f"Computed NAV: ${nav_usd:.2f} USD")

    pushed = []
    for token_id in TOKEN_IDS:
        try:
            logger.info(f"Pushing floor price to oracle for token {token_id}...")
            tx_hash = push_floor_to_oracle(token_id, floor_eth)
            logger.info(f"Token {token_id} pushed with tx: {tx_hash}")
            pushed.append({"tokenId": token_id, "txHash": tx_hash})
            
            logger.info(f"Refreshing LTV and risk for token {token_id}...")
            refresh_ltv_and_risk(token_id)
            logger.info(f"Token {token_id} LTV and risk refreshed")
        except Exception as e:
            logger.error(f"Failed to process token {token_id}: {e}")

    state["last_oracle"] = {
        "floorEth": floor_eth,
        "ethUsd": eth_usd,
        "quantity": TOKEN_QUANTITY,
        "weighting": TOKEN_WEIGHTING,
        "navUsd": nav_usd,
        "pushed": pushed,
        "updatedAt": int(time.time()),
    }
    state["last_success_at"] = int(time.time())
    state["last_error"] = None
    logger.info("=== NAV loop iteration completed successfully ===")


def ai_nav_loop():
    logger.info("Starting background NAV loop thread...")
    while True:
        try:
            nav_loop_once()
        except Exception as error:  # noqa: BLE001
            state["last_error"] = str(error)
            logger.error(f"NAV loop error: {error}", exc_info=True)
        logger.debug(f"Sleeping for {UPDATE_INTERVAL_SECONDS} seconds...")
        time.sleep(UPDATE_INTERVAL_SECONDS)


@app.get("/oracle/latest")
def get_latest_oracle():
    logger.debug("GET /oracle/latest called")
    if not state["last_oracle"]:
        logger.debug("No oracle data available yet")
        return {"status": "pending", "lastError": state["last_error"]}
    logger.debug(f"Returning oracle data: {state['last_oracle']}")
    return {
        "status": "ok",
        "lastOracle": state["last_oracle"],
        "lastSuccessAt": state["last_success_at"],
        "lastError": state["last_error"],
    }


@app.get("/ltv/{token_id}")
def get_ltv(token_id: int):
    logger.debug(f"GET /ltv/{token_id} called")
    row = state["ltv"].get(token_id)
    if not row:
        logger.warning(f"LTV not available for token {token_id}")
        raise HTTPException(status_code=404, detail="LTV not available for token")
    logger.debug(f"Returning LTV for token {token_id}: {row}")
    return row


@app.get("/risk/{token_id}")
def get_risk(token_id: int):
    logger.debug(f"GET /risk/{token_id} called")
    row = state["risk"].get(token_id)
    if not row:
        logger.warning(f"Risk not available for token {token_id}")
        raise HTTPException(status_code=404, detail="Risk not available for token")
    logger.debug(f"Returning risk for token {token_id}: {row}")
    return row


@app.get("/health")
def health():
    logger.debug("GET /health called")
    is_configured = bool(w3 and account and oracle_contract and loan_contract)
    logger.info(f"Health check: w3={bool(w3)}, account={bool(account)}, oracle_contract={bool(oracle_contract)}, loan_contract={bool(loan_contract)}, configured={is_configured}")
    return {
        "status": "ok",
        "configured": is_configured,
        "tokenIds": TOKEN_IDS,
    }


if __name__ == "__main__":
    logger.info("=" * 80)
    logger.info("STARTING BACKEND SERVER")
    logger.info("=" * 80)
    
    thread = threading.Thread(target=ai_nav_loop, daemon=True)
    thread.start()
    
    logger.info("Starting FastAPI server on http://0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
    uvicorn.run(app, host="0.0.0.0", port=8000)
