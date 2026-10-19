from shop.pricing import line_total


def test_line_total_multiplies_the_unit_price():
    assert line_total({"pen": 2}, "pen", 3) == 6
