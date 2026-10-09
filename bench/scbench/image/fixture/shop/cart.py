"""A cart with a planted pass-through wrapper."""

from shop.pricing import line_total


def cart_total(catalog, lines):
    """Return the total price of every line in the cart."""
    return sum(line_total(catalog, sku, quantity) for sku, quantity in lines)


def total(catalog, lines):
    """Return the cart total."""
    return cart_total(catalog, lines)
