def check_total(cart, expected):
    _compare(cart.total(), expected)


def _compare(actual, expected):
    assert actual == expected, f"{actual} != {expected}"
