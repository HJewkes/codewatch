import pytest

from shop.cart import Cart


def level1(cart):
    level2(cart)


def level2(cart):
    level3(cart)


def level3(cart):
    level4(cart)


def level4(cart):
    assert cart.total() == 0


def level0(cart):
    level1(cart)


@pytest.mark.smoke
def test_add_smoke():
    Cart().add("pen", 2)


def test_helper_at_depth_four():
    level1(Cart())


def test_helper_past_depth_four():
    level0(Cart())


def test_shape_only():
    cart = Cart()
    assert cart.items is not None
    assert len(cart.items) == 0


def test_repeated_check():
    cart = Cart()
    assert cart.total() == 0
    cart.add("pen", 0)
    assert cart.total() == 0


def test_compares_to_itself():
    cart = Cart()
    assert cart.total() == cart.total()


class TestCart:
    def test_type_only(self):
        assert isinstance(Cart(), Cart)
