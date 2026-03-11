import hashlib
import json
import time


class Vault:
    def __init__(self):
        self._records = {}
        self._history = []
        self._ts = time.time()

    def ingest(self, raw_collection):
        for item in raw_collection:
            key = self._derive_key(item)
            self._records[key] = {
                "payload": item,
                "weight": item.get("w", 1),
                "group": item.get("g", "default"),
                "ts": time.time(),
            }
        self._history.append(
            {"action": "ingest", "count": len(raw_collection), "ts": time.time()}
        )

    def _derive_key(self, item):
        raw = json.dumps(item, sort_keys=True)
        return hashlib.md5(raw.encode()).hexdigest()[:10]

    def query(self, group=None, min_weight=0):
        results = []
        for key, rec in self._records.items():
            if group and rec["group"] != group:
                continue
            if rec["weight"] < min_weight:
                continue
            results.append({"key": key, **rec["payload"]})
        return sorted(results, key=lambda x: x.get("w", 0), reverse=True)

    def mutate(self, key, updates):
        if key in self._records:
            self._records[key]["payload"].update(updates)
            self._history.append({"action": "mutate", "key": key, "ts": time.time()})
            return True
        return False

    def purge(self, group):
        keys_to_remove = [k for k, v in self._records.items() if v["group"] == group]
        for k in keys_to_remove:
            del self._records[k]
        self._history.append(
            {
                "action": "purge",
                "group": group,
                "count": len(keys_to_remove),
                "ts": time.time(),
            }
        )
        return len(keys_to_remove)

    def export(self):
        return {
            "records": {k: v["payload"] for k, v in self._records.items()},
            "meta": {
                "total": len(self._records),
                "groups": list(set(v["group"] for v in self._records.values())),
                "history_len": len(self._history),
            },
        }
