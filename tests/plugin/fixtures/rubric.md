Themes: parsing and pricing logic are mixed in shop/cart.py; tests cover only the happy path.
Fix first: keep the discount rounding in one place before adding new price rules.
House style: small pure functions, dataclasses for records, errors raised at the CLI edge.
