import pytest
from numpy.testing import assert_allclose

from shop.cart import Cart
from tests._checks import check_total


def make_cart():
    cart = Cart()
    cart.add("pen", 2, qty=3)
    return cart


def expect_items(cart, count):
    assert len(cart.items) == count and cart.total() > 0


def test_total_sums_price_times_qty():
    assert make_cart().total() == 6


def test_total_through_an_imported_helper():
    check_total(make_cart(), 6)


def test_total_through_a_local_helper():
    expect_items(make_cart(), 1)


def test_rejects_zero_qty():
    with pytest.raises(ValueError, match="positive"):
        Cart().add("pen", 2, qty=0)


def test_total_is_close():
    assert_allclose(make_cart().total(), 6.0)


def test_type_and_value():
    cart = make_cart()
    assert isinstance(cart, Cart) and cart.total() == 6


class TestCart:
    def _assert_empty(self, cart):
        assert cart.items == []

    def test_new_cart_is_empty(self):
        self._assert_empty(Cart())

    def test_add_twice(self):
        cart = make_cart()
        cart.add("ink", 5)
        assert cart.total() == 11
        assert cart.items[-1] == ("ink", 5, 1)
