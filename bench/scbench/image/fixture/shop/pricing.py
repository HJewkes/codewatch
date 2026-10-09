"""Prices with planted findings: an unused import and a swallowed exception."""

import json


def unit_price(catalog, sku):
    """Return the price of one item, or zero when the SKU is unknown."""
    try:
        return catalog[sku]
    except Exception:
        pass
    return 0


def line_total(catalog, sku, quantity):
    """Return the price of a cart line."""
    return unit_price(catalog, sku) * quantity
