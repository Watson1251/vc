import os, signal, threading, time, psutil

_lock = threading.RLock()
_running = {}  # target_id -> {"pid": int, "cmd": str, "started": float, "status": "running"|"stopping"}

def register(target_id: str, pid: int, cmd: str):
    with _lock:
        _running[target_id] = {"pid": pid, "cmd": cmd, "started": time.time(), "status": "running"}

def unregister(target_id: str):
    with _lock:
        _running.pop(target_id, None)

def list_tasks():
    with _lock:
        return {k: v.copy() for k, v in _running.items()}

def cancel(target_id: str) -> bool:
    with _lock:
        info = _running.get(target_id)
        if not info:
            return False
        info["status"] = "stopping"
        pid = info["pid"]

    try:
        pgid = os.getpgid(pid)
    except Exception:
        pgid = None

    # DEBUG
    try:
        import logging
        logging.getLogger(__name__).info(f"[cancel] target={target_id} pid={pid} pgid={pgid}")
    except Exception:
        pass

    # First: SIGTERM the process group (preferred)
    if pgid:
        try:
            os.killpg(pgid, signal.SIGTERM)
        except Exception:
            pass
    else:
        try:
            p = psutil.Process(pid)
            for c in p.children(recursive=True):
                try: c.terminate()
                except Exception: pass
            p.terminate()
        except Exception:
            pass

    # Wait briefly, then escalate to SIGKILL group
    try:
        p = psutil.Process(pid)
        p.wait(timeout=10)
        return True
    except Exception:
        pass

    if pgid:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except Exception:
            pass
    else:
        try:
            p = psutil.Process(pid)
            for c in p.children(recursive=True):
                try: c.kill()
                except Exception: pass
            p.kill()
        except Exception:
            pass
    return True
