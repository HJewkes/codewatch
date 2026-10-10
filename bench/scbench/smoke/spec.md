# Stock ledger (synthetic spec for the credential smoke)

1. `restock(path, sku, amount)` reads the JSON object at `path`, adds `amount` to `sku`
   (a missing SKU starts at 0) and returns the updated object.
2. If the file at `path` cannot be read, `restock` returns `None`.
3. `total(stock)` returns the sum of every integer count; other values are ignored.
