import unittest

from runner.prompt import retry_message


class RetryHelperTest(unittest.TestCase):
    def test_one_site_helper_reject_names_function_and_says_inline(self):
        result = {"reasons": ["adds a function called from one place: _stage"], "retry_message": "FAIL: generic"}
        got = retry_message(result, {"pass": True}, [])
        self.assertIn("_stage", got)
        self.assertIn("nline", got)

    def test_other_rejects_keep_the_generic_message(self):
        result = {"reasons": ["something else"], "retry_message": "FAIL: generic"}
        self.assertEqual(retry_message(result, {"pass": True}, []), "FAIL: generic")


if __name__ == "__main__":
    unittest.main()
