import os
import time
import requests
from dotenv import load_dotenv
from web3 import Web3
from fastapi import FastAPI
import uvicorn
import threading

load_dotenv()

ALCHEMY_URL = os.getenv("ALCHEMY_URL", "")
PRIVATE_KEY = os.getenv("PRIVATE_KEY", "")
ORACLE_ADDRESS = os.getenv("ORACLE_PROXY_ADDRESS", "")

ORACLE_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "_nav", "type": "uint256"},
            {"internalType": "uint256", "name": "_timestamp", "type": "uint256"}
        ],
        "name": "updateNAV",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "currentNAV",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "isStale",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    }
]

app = FastAPI()

w3 = None
account = None
oracle_contract = None

if ALCHEMY_URL and PRIVATE_KEY and ORACLE_ADDRESS:
    w3 = Web3(Web3.HTTPProvider(ALCHEMY_URL))
    account = w3.eth.account.from_key(PRIVATE_KEY)
    oracle_contract = w3.eth.contract(address=w3.to_checksum_address(ORACLE_ADDRESS), abi=ORACLE_ABI)

def fetch_floor_price():
    # Simulate fetching from Alchemy / CoinGecko
    return 1500.00 

def push_nav_to_oracle(nav_value):
    if not w3 or not account:
        print(f"Skipping on-chain push, config missing. Calculated NAV: {nav_value}")
        return
    nav_int = int(nav_value * (10**18))
    timestamp = int(time.time())
    
    nonce = w3.eth.get_transaction_count(account.address)
    txn = oracle_contract.functions.updateNAV(nav_int, timestamp).build_transaction({
        'chainId': 11155111,
        'gas': 500000,
        'maxFeePerGas': w3.to_wei('20', 'gwei'),
        'maxPriorityFeePerGas': w3.to_wei('2', 'gwei'),
        'nonce': nonce,
    })
    signed_txn = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed_txn.rawTransaction)
    print(f"Pushed NAV {nav_value}. Hash: {w3.to_hex(tx_hash)}")

def ai_nav_loop():
    while True:
        try:
            print("Checking NAV...")
            qty = 10 
            floor = fetch_floor_price()
            yield_value = 50.0 
            nav = (qty * floor) + yield_value
            push_nav_to_oracle(nav)
        except Exception as e:
            print(f"Error in NAV loop: {e}")
        time.sleep(3600)

@app.get("/oracle/latest")
def get_latest_nav():
    if oracle_contract:
        try:
            nav = oracle_contract.functions.currentNAV().call()
            stale = oracle_contract.functions.isStale().call()
            return {"nav": nav / (10**18), "isStale": stale}
        except Exception as e:
            return {"error": str(e)}
    return {"nav": 15050.0, "isStale": False, "simulated": True}

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    t = threading.Thread(target=ai_nav_loop, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=8000)
