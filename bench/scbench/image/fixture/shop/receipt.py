"""Receipt and quote rows with a planted clone."""


def receipt_rows(catalog, lines):
    """Return one printable row per cart line."""
    rows = []
    for sku, quantity in lines:
        price = catalog.get(sku, 0)
        if quantity <= 0:
            continue
        label = f"{sku} x{quantity}"
        rows.append((label, price * quantity, round(price * quantity * 0.2, 2)))
    rows.sort(key=lambda row: (row[1], row[0]))
    return rows


def quote_rows(catalog, lines):
    """Return one printable row per quoted line."""
    rows = []
    for sku, quantity in lines:
        price = catalog.get(sku, 0)
        if quantity <= 0:
            continue
        label = f"{sku} x{quantity}"
        rows.append((label, price * quantity, round(price * quantity * 0.2, 2)))
    rows.sort(key=lambda row: (row[1], row[0]))
    return rows
