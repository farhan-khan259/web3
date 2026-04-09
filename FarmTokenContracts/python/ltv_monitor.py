import asyncio
import json
import logging
import os
import signal
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

import aiohttp
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor
from web3 import Web3
from web3.contract import Contract
import websockets


logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
)
logger = logging.getLogger("ltv-monitor")


def _load_env_files() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(base_dir, ".env"), override=False)
    load_dotenv(os.path.join(base_dir, ".env.local"), override=True)

    repo_root = os.path.abspath(os.path.join(base_dir, ".."))
    load_dotenv(os.path.join(repo_root, ".env"), override=False)
    load_dotenv(os.path.join(repo_root, ".env.local"), override=True)

    backend_dir = os.path.join(repo_root, "backend")
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
    load_dotenv(os.path.join(backend_dir, ".env.local"), override=True)


_load_env_files()


def _parse_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_float(value: str, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _parse_int(value: str, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


@dataclass
class Config:
    rpc_url: str
    vault_address: str
    loan_engine_address: str
    oracle_registry_address: str
    revenue_distributor_address: str
    database_url: str
    panic_threshold_ltv: float
    panic_recovery_ltv: float
    check_interval_seconds: int
    alert_webhook_url: str
    private_key: str
    auto_exit_panic: bool
    auto_distribute_revenue: bool
    ws_host: str
    ws_port: int
    chainlink_feed_address: str
    stale_feed_max_seconds: int
    max_retries: int


def load_config() -> Config:
    raw_contract_addresses = os.getenv("CONTRACT_ADDRESSES", "").strip()
    parsed_contracts: Dict[str, str] = {}
    if raw_contract_addresses:
        try:
            parsed = json.loads(raw_contract_addresses)
            if isinstance(parsed, dict):
                parsed_contracts = {str(k).lower(): str(v) for k, v in parsed.items()}
        except Exception as exc:
            logger.warning("Failed to parse CONTRACT_ADDRESSES JSON: %s", exc)

    def pick_address(*keys: str, env_fallback: Optional[str] = None) -> str:
        for key in keys:
            value = parsed_contracts.get(key.lower())
            if value:
                return value
        if env_fallback:
            return os.getenv(env_fallback, "").strip()
        return ""

    return Config(
        rpc_url=os.getenv("RPC_URL", os.getenv("ALCHEMY_URL", "")).strip(),
        vault_address=pick_address("vault", env_fallback="VAULT_ADDRESS"),
        loan_engine_address=pick_address("loanengine", "loan_engine", env_fallback="LOAN_ENGINE_ADDRESS"),
        oracle_registry_address=pick_address("oracleregistry", "oracle_registry", env_fallback="ORACLE_REGISTRY_ADDRESS"),
        revenue_distributor_address=pick_address("revenuedistributor", "revenue_distributor", env_fallback="REVENUE_DISTRIBUTOR_ADDRESS"),
        database_url=os.getenv("DATABASE_URL", os.getenv("PANIC_EVENTS_DATABASE_URL", "")).strip(),
        panic_threshold_ltv=_parse_float(os.getenv("PANIC_THRESHOLD_LTV", "0.85"), 0.85),
        panic_recovery_ltv=_parse_float(os.getenv("PANIC_RECOVERY_LTV", "0.60"), 0.60),
        check_interval_seconds=_parse_int(os.getenv("CHECK_INTERVAL_SECONDS", "60"), 60),
        alert_webhook_url=os.getenv("ALERT_WEBHOOK_URL", "").strip(),
        private_key=os.getenv("PRIVATE_KEY", os.getenv("ADMIN_PRIVATE_KEY", "")).strip(),
        auto_exit_panic=_parse_bool(os.getenv("AUTO_EXIT_PANIC", "false"), False),
        auto_distribute_revenue=_parse_bool(os.getenv("AUTO_DISTRIBUTE_REVENUE", "true"), True),
        ws_host=os.getenv("MONITOR_WS_HOST", "0.0.0.0").strip(),
        ws_port=_parse_int(os.getenv("MONITOR_WS_PORT", "8765"), 8765),
        chainlink_feed_address=os.getenv("CHAINLINK_FEED_ADDRESS", "").strip(),
        stale_feed_max_seconds=_parse_int(os.getenv("MAX_FEED_STALE_SECONDS", "3600"), 3600),
        max_retries=_parse_int(os.getenv("MAX_RPC_RETRIES", "4"), 4),
    )


VAULT_ABI = [
    {
        "name": "getLockedRightIds",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256[]"}],
    },
    {
        "name": "emergencyPause",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
    {
        "name": "pause",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
]

LOAN_ENGINE_ABI = [
    {
        "name": "outstandingDebt",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "rightsId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "getCurrentLTV",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "rightsId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "getHealthFactor",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "rightsId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "isPanicMode",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "rightsId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "enterPanicMode",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "exitPanicMode",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
]

ORACLE_REGISTRY_ABI = [
    {
        "name": "ethUsdFeed",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address"}],
    },
]

CHAINLINK_FEED_ABI = [
    {
        "name": "latestRoundData",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "roundId", "type": "uint80"},
            {"name": "answer", "type": "int256"},
            {"name": "startedAt", "type": "uint256"},
            {"name": "updatedAt", "type": "uint256"},
            {"name": "answeredInRound", "type": "uint80"},
        ],
    }
]

REVENUE_DISTRIBUTOR_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "uint256", "name": "tokenId", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"},
            {"indexed": True, "internalType": "address", "name": "payer", "type": "address"},
        ],
        "name": "RevenueReceived",
        "type": "event",
    },
    {
        "name": "distributeRevenue",
        "type": "function",
        "stateMutability": "payable",
        "inputs": [
            {"name": "tokenId", "type": "uint256"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [],
    },
]


class Database:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def _connect(self):
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is not set")
        return psycopg2.connect(self.database_url)

    def initialize(self) -> None:
        if not self.database_url:
            logger.warning("DATABASE_URL not configured; DB writes will be skipped")
            return

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ltv_snapshots (
                        id BIGSERIAL PRIMARY KEY,
                        token_id BIGINT NOT NULL,
                        current_ltv_bps NUMERIC NOT NULL,
                        health_factor NUMERIC NOT NULL,
                        debt_wei NUMERIC NOT NULL,
                        is_panic BOOLEAN NOT NULL,
                        block_number BIGINT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS panic_events (
                        id BIGSERIAL PRIMARY KEY,
                        token_id BIGINT NOT NULL,
                        action TEXT NOT NULL,
                        trigger_ltv NUMERIC,
                        panic_threshold NUMERIC,
                        tx_hash TEXT,
                        message TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS revenue_events (
                        id BIGSERIAL PRIMARY KEY,
                        token_id BIGINT NOT NULL,
                        amount_wei NUMERIC NOT NULL,
                        tx_hash TEXT NOT NULL,
                        log_index BIGINT NOT NULL,
                        processed BOOLEAN NOT NULL DEFAULT FALSE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (tx_hash, log_index)
                    );
                    """
                )
            conn.commit()

    def write_snapshot(self, token_id: int, ltv_bps: float, health_factor: float, debt_wei: int, is_panic: bool, block_number: int) -> None:
        if not self.database_url:
            return
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ltv_snapshots (token_id, current_ltv_bps, health_factor, debt_wei, is_panic, block_number)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (token_id, ltv_bps, health_factor, debt_wei, is_panic, block_number),
                )
            conn.commit()

    def write_panic_event(
        self,
        token_id: int,
        action: str,
        trigger_ltv: Optional[float],
        panic_threshold: Optional[float],
        tx_hash: Optional[str],
        message: str,
    ) -> None:
        if not self.database_url:
            return
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO panic_events (token_id, action, trigger_ltv, panic_threshold, tx_hash, message)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (token_id, action, trigger_ltv, panic_threshold, tx_hash, message),
                )
            conn.commit()

    def write_revenue_event(self, token_id: int, amount_wei: int, tx_hash: str, log_index: int) -> None:
        if not self.database_url:
            return
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO revenue_events (token_id, amount_wei, tx_hash, log_index)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (tx_hash, log_index) DO NOTHING
                    """,
                    (token_id, amount_wei, tx_hash, log_index),
                )
            conn.commit()


class MonitorService:
    def __init__(self, config: Config):
        self.config = config
        self.shutdown_event = asyncio.Event()
        self.clients: Set[websockets.WebSocketServerProtocol] = set()
        self.last_status: Dict[str, Any] = {
            "startedAt": int(time.time()),
            "lastRunAt": None,
            "activeLoans": 0,
            "panicCount": 0,
            "lastError": None,
        }

        self.w3 = Web3(Web3.HTTPProvider(self.config.rpc_url))
        if not self.w3.is_connected():
            raise RuntimeError("Web3 connection failed. Check RPC_URL")

        self.account = self.w3.eth.account.from_key(self.config.private_key) if self.config.private_key else None
        self.db = Database(self.config.database_url)

        self.vault = self._contract(self.config.vault_address, VAULT_ABI)
        self.loan_engine = self._contract(self.config.loan_engine_address, LOAN_ENGINE_ABI)
        self.oracle_registry = self._contract(self.config.oracle_registry_address, ORACLE_REGISTRY_ABI)
        self.revenue_distributor = self._contract(self.config.revenue_distributor_address, REVENUE_DISTRIBUTOR_ABI)

        self._seen_revenue_logs: Set[str] = set()
        self._last_revenue_block = self.w3.eth.block_number

    def _contract(self, address: str, abi: List[Dict[str, Any]]) -> Optional[Contract]:
        if not address:
            return None
        return self.w3.eth.contract(address=self.w3.to_checksum_address(address), abi=abi)

    async def retry(self, label: str, fn, retries: Optional[int] = None, base_delay: float = 1.0):
        total = retries if retries is not None else self.config.max_retries
        last_error = None
        for attempt in range(1, total + 1):
            try:
                return await fn()
            except Exception as exc:
                last_error = exc
                if attempt == total:
                    break
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning("%s failed (attempt %s/%s): %s. Retrying in %.1fs", label, attempt, total, exc, delay)
                await asyncio.sleep(delay)
        raise RuntimeError(f"{label} failed after {total} retries: {last_error}")

    async def _call_view(self, contract: Contract, function_name: str, *args):
        async def _do_call():
            return await asyncio.to_thread(getattr(contract.functions, function_name)(*args).call)

        return await self.retry(f"view:{function_name}", _do_call)

    async def _send_tx(self, contract: Contract, function_name: str, *args, value: int = 0) -> str:
        if self.account is None:
            raise RuntimeError("PRIVATE_KEY is required for transactions")

        async def _do_send() -> str:
            fn = getattr(contract.functions, function_name)(*args)
            nonce = await asyncio.to_thread(self.w3.eth.get_transaction_count, self.account.address)
            gas_price = await asyncio.to_thread(lambda: self.w3.eth.gas_price)
            tx = fn.build_transaction(
                {
                    "from": self.account.address,
                    "nonce": nonce,
                    "chainId": self.w3.eth.chain_id,
                    "gas": 700000,
                    "gasPrice": gas_price,
                    "value": value,
                }
            )
            signed = self.w3.eth.account.sign_transaction(tx, private_key=self.config.private_key)
            tx_hash = await asyncio.to_thread(self.w3.eth.send_raw_transaction, signed.raw_transaction)
            receipt = await asyncio.to_thread(self.w3.eth.wait_for_transaction_receipt, tx_hash, 120)
            if receipt.status != 1:
                raise RuntimeError(f"Transaction reverted for {function_name}")
            return self.w3.to_hex(tx_hash)

        return await self.retry(f"tx:{function_name}", _do_send)

    async def initialize(self) -> None:
        await asyncio.to_thread(self.db.initialize)

    async def send_alert(self, level: str, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        payload = {
            "level": level,
            "message": message,
            "timestamp": int(time.time()),
            "extra": extra or {},
        }
        logger.log(logging.WARNING if level != "info" else logging.INFO, "%s", payload)

        await self.broadcast({"type": "alert", **payload})

        if not self.config.alert_webhook_url:
            return

        try:
            async with aiohttp.ClientSession() as session:
                await session.post(self.config.alert_webhook_url, json=payload, timeout=10)
        except Exception as exc:
            logger.error("Webhook alert failed: %s", exc)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        if not self.clients:
            return
        dead: List[websockets.WebSocketServerProtocol] = []
        message = json.dumps(payload)
        for client in self.clients:
            try:
                await client.send(message)
            except Exception:
                dead.append(client)
        for client in dead:
            self.clients.discard(client)

    async def get_active_loan_token_ids(self) -> List[int]:
        if self.vault is None or self.loan_engine is None:
            return []

        locked_ids = await self._call_view(self.vault, "getLockedRightIds")
        if not locked_ids:
            return []

        async def debt_for(token_id: int) -> Tuple[int, int]:
            debt = await self._call_view(self.loan_engine, "outstandingDebt", token_id)
            return token_id, int(debt)

        debt_rows = await asyncio.gather(*[debt_for(int(token_id)) for token_id in locked_ids], return_exceptions=True)

        active: List[int] = []
        for row in debt_rows:
            if isinstance(row, Exception):
                logger.warning("Failed debt lookup: %s", row)
                continue
            token_id, debt = row
            if debt > 0:
                active.append(token_id)
        return active

    async def get_health_factor(self, token_id: int, ltv_bps: int) -> float:
        if self.loan_engine is None:
            return 0.0
        try:
            raw = await self._call_view(self.loan_engine, "getHealthFactor", token_id)
            return float(raw)
        except Exception:
            if ltv_bps <= 0:
                return 9999.0
            return round(10000.0 / max(float(ltv_bps), 1.0), 4)

    async def handle_ltv_checks(self) -> None:
        if self.loan_engine is None:
            await self.send_alert("error", "LoanEngine contract is not configured")
            return

        token_ids = await self.get_active_loan_token_ids()
        panic_threshold_bps = self.config.panic_threshold_ltv * 10000.0
        recovery_threshold_bps = self.config.panic_recovery_ltv * 10000.0

        panic_count = 0

        async def process_token(token_id: int) -> None:
            nonlocal panic_count
            ltv_bps = int(await self._call_view(self.loan_engine, "getCurrentLTV", token_id))
            debt_wei = int(await self._call_view(self.loan_engine, "outstandingDebt", token_id))
            is_panic = bool(await self._call_view(self.loan_engine, "isPanicMode", token_id))
            health_factor = await self.get_health_factor(token_id, ltv_bps)
            block_number = self.w3.eth.block_number

            await asyncio.to_thread(
                self.db.write_snapshot,
                token_id,
                float(ltv_bps),
                float(health_factor),
                int(debt_wei),
                bool(is_panic),
                int(block_number),
            )

            if is_panic:
                panic_count += 1

            if ltv_bps > panic_threshold_bps and not is_panic:
                tx_hash = await self._send_tx(self.loan_engine, "enterPanicMode", token_id)
                await asyncio.to_thread(
                    self.db.write_panic_event,
                    token_id,
                    "panic_enter",
                    float(ltv_bps),
                    float(panic_threshold_bps),
                    tx_hash,
                    "Auto-enter panic mode due to threshold breach",
                )
                await self.send_alert(
                    "warning",
                    f"Token {token_id} entered panic mode",
                    {
                        "tokenId": token_id,
                        "ltvBps": ltv_bps,
                        "thresholdBps": panic_threshold_bps,
                        "txHash": tx_hash,
                    },
                )

            if self.config.auto_exit_panic and is_panic and ltv_bps < recovery_threshold_bps:
                tx_hash = await self._send_tx(self.loan_engine, "exitPanicMode", token_id)
                await asyncio.to_thread(
                    self.db.write_panic_event,
                    token_id,
                    "panic_exit",
                    float(ltv_bps),
                    float(recovery_threshold_bps),
                    tx_hash,
                    "Auto-exit panic mode due to recovery threshold",
                )
                await self.send_alert(
                    "info",
                    f"Token {token_id} exited panic mode",
                    {
                        "tokenId": token_id,
                        "ltvBps": ltv_bps,
                        "recoveryThresholdBps": recovery_threshold_bps,
                        "txHash": tx_hash,
                    },
                )

            await self.broadcast(
                {
                    "type": "ltv-update",
                    "tokenId": token_id,
                    "ltvBps": ltv_bps,
                    "healthFactor": health_factor,
                    "debtWei": str(debt_wei),
                    "isPanic": is_panic,
                    "timestamp": int(time.time()),
                }
            )

        results = await asyncio.gather(*[process_token(token_id) for token_id in token_ids], return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                logger.error("LTV token processing error: %s", result)

        self.last_status["lastRunAt"] = int(time.time())
        self.last_status["activeLoans"] = len(token_ids)
        self.last_status["panicCount"] = panic_count

    async def get_chainlink_feed_address(self) -> str:
        if self.config.chainlink_feed_address:
            return self.config.chainlink_feed_address
        if self.oracle_registry is None:
            return ""
        try:
            feed_addr = await self._call_view(self.oracle_registry, "ethUsdFeed")
            return str(feed_addr)
        except Exception:
            return ""

    async def try_emergency_pause(self) -> Optional[str]:
        if self.vault is None:
            return None
        for method_name in ("emergencyPause", "pause"):
            try:
                return await self._send_tx(self.vault, method_name)
            except Exception:
                continue
        return None

    async def oracle_health_check(self) -> None:
        feed_address = await self.get_chainlink_feed_address()
        if not feed_address:
            await self.send_alert("error", "Oracle health check skipped: Chainlink feed address unavailable")
            return

        feed_contract = self.w3.eth.contract(address=self.w3.to_checksum_address(feed_address), abi=CHAINLINK_FEED_ABI)
        round_data = await self._call_view(feed_contract, "latestRoundData")
        updated_at = int(round_data[3])
        age_seconds = int(time.time()) - updated_at

        if age_seconds > self.config.stale_feed_max_seconds:
            tx_hash = await self.try_emergency_pause()
            await self.send_alert(
                "critical",
                "Chainlink feed is stale",
                {
                    "feedAddress": feed_address,
                    "ageSeconds": age_seconds,
                    "maxAllowed": self.config.stale_feed_max_seconds,
                    "pauseTxHash": tx_hash,
                },
            )

    async def revenue_monitor_loop(self) -> None:
        if self.revenue_distributor is None:
            logger.info("RevenueDistributor not configured; revenue monitor loop idle")
            return

        event_obj = self.revenue_distributor.events.RevenueReceived()

        while not self.shutdown_event.is_set():
            try:
                latest_block = self.w3.eth.block_number
                from_block = self._last_revenue_block + 1
                if from_block > latest_block:
                    await asyncio.sleep(2)
                    continue

                logs = await asyncio.to_thread(
                    event_obj.get_logs,
                    fromBlock=from_block,
                    toBlock=latest_block,
                )
                self._last_revenue_block = latest_block

                for log in logs:
                    token_id = int(log["args"]["tokenId"])
                    amount = int(log["args"]["amount"])
                    payer = str(log["args"]["payer"]).lower()
                    tx_hash = log["transactionHash"].hex()
                    log_index = int(log["logIndex"])
                    dedupe_key = f"{tx_hash}:{log_index}"
                    if dedupe_key in self._seen_revenue_logs:
                        continue
                    self._seen_revenue_logs.add(dedupe_key)

                    await asyncio.to_thread(self.db.write_revenue_event, token_id, amount, tx_hash, log_index)

                    if self.config.auto_distribute_revenue:
                        if self.account and payer == self.account.address.lower():
                            # Prevent recursive loops when our own distributeRevenue tx emits RevenueReceived.
                            continue
                        try:
                            distribution_tx = await self._send_tx(
                                self.revenue_distributor,
                                "distributeRevenue",
                                token_id,
                                amount,
                                value=amount,
                            )
                            await self.send_alert(
                                "info",
                                f"Auto revenue distribution executed for token {token_id}",
                                {"tokenId": token_id, "amountWei": str(amount), "txHash": distribution_tx},
                            )
                        except Exception as exc:
                            await self.send_alert(
                                "warning",
                                f"Revenue distribution failed for token {token_id}",
                                {"tokenId": token_id, "amountWei": str(amount), "error": str(exc)},
                            )
            except Exception as exc:
                self.last_status["lastError"] = str(exc)
                logger.error("Revenue monitor error: %s", exc)

            await asyncio.sleep(5)

    async def ltv_monitor_loop(self) -> None:
        while not self.shutdown_event.is_set():
            try:
                await self.handle_ltv_checks()
                await self.oracle_health_check()
            except Exception as exc:
                self.last_status["lastError"] = str(exc)
                logger.error("LTV monitor loop error: %s", exc)
                await self.send_alert("error", "LTV monitor loop failure", {"error": str(exc)})

            await asyncio.sleep(self.config.check_interval_seconds)

    async def ws_handler(self, websocket: websockets.WebSocketServerProtocol) -> None:
        self.clients.add(websocket)
        try:
            await websocket.send(
                json.dumps(
                    {
                        "type": "status",
                        "status": self.last_status,
                        "timestamp": int(time.time()),
                    }
                )
            )
            async for raw_message in websocket:
                try:
                    payload = json.loads(raw_message)
                except Exception:
                    payload = {"type": "unknown"}

                if payload.get("type") == "ping":
                    await websocket.send(json.dumps({"type": "pong", "timestamp": int(time.time())}))
                elif payload.get("type") == "status":
                    await websocket.send(json.dumps({"type": "status", "status": self.last_status}))
        finally:
            self.clients.discard(websocket)

    async def websocket_loop(self) -> None:
        async with websockets.serve(self.ws_handler, self.config.ws_host, self.config.ws_port):
            logger.info("WebSocket server started at ws://%s:%s", self.config.ws_host, self.config.ws_port)
            await self.shutdown_event.wait()

    async def status_broadcast_loop(self) -> None:
        while not self.shutdown_event.is_set():
            await self.broadcast(
                {
                    "type": "status",
                    "status": self.last_status,
                    "timestamp": int(time.time()),
                }
            )
            await asyncio.sleep(10)

    async def run(self) -> None:
        await self.initialize()

        tasks = [
            asyncio.create_task(self.ltv_monitor_loop(), name="ltv-monitor"),
            asyncio.create_task(self.revenue_monitor_loop(), name="revenue-monitor"),
            asyncio.create_task(self.websocket_loop(), name="websocket-server"),
            asyncio.create_task(self.status_broadcast_loop(), name="status-broadcast"),
        ]

        await self.shutdown_event.wait()

        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def request_shutdown(self) -> None:
        logger.info("Shutdown requested")
        self.shutdown_event.set()


def install_signal_handlers(service: MonitorService) -> None:
    loop = asyncio.get_event_loop()

    def _handler(signum, _frame):
        logger.info("Signal received: %s", signum)
        service.request_shutdown()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, service.request_shutdown)
        except NotImplementedError:
            signal.signal(sig, _handler)


async def async_main() -> None:
    config = load_config()
    logger.info("Loaded config: check_interval=%ss panic_threshold=%.2f panic_recovery=%.2f", config.check_interval_seconds, config.panic_threshold_ltv, config.panic_recovery_ltv)

    required = {
        "RPC_URL": config.rpc_url,
        "LOAN_ENGINE_ADDRESS": config.loan_engine_address,
        "VAULT_ADDRESS": config.vault_address,
        "ORACLE_REGISTRY_ADDRESS": config.oracle_registry_address,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Missing required configuration: {', '.join(missing)}")

    service = MonitorService(config)
    install_signal_handlers(service)

    try:
        await service.run()
    finally:
        logger.info("Monitor stopped")


def main() -> None:
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        logger.info("Monitor interrupted")


if __name__ == "__main__":
    main()
