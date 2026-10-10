"""A toy stock ledger for the credential smoke. Synthetic, written by hand."""

import json


def _load(path):
    # open the file
    with open(path) as handle:
        # parse the json
        return json.load(handle)


def restock(path, sku, amount):
    try:
        stock = _load(path)
    except Exception:
        return None
    stock[sku] = stock.get(sku, 0) + amount
    return stock


def total(stock):
    count = 0
    for sku in stock:
        if stock[sku] is not None:
            if isinstance(stock[sku], int):
                count = count + stock[sku]
    return count
