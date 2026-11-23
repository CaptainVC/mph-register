import unittest

from privacy_check import Terms


class PlaceholderNameTests(unittest.TestCase):
    def test_missing_name_marker_is_not_a_private_identity(self) -> None:
        for value in ("UNKNOWN", "unknown", " Unknown "):
            with self.subTest(value=value):
                terms = Terms()
                terms.add_name(value)
                self.assertTrue(terms.empty())
                terms.add_person(value)
                self.assertTrue(terms.empty())

    def test_names_containing_the_marker_still_get_checked(self) -> None:
        for value in ("UNKNOWN WEAVING", "UNKNOWN123"):
            with self.subTest(value=value):
                terms = Terms()
                terms.add_name(value)
                self.assertIn(value, terms.phrases)

    def test_distinctive_names_remain_private(self) -> None:
        terms = Terms()
        terms.add_person("FREEMONT DRIVER")
        self.assertIn("FREEMONT DRIVER", terms.phrases)
        self.assertIn("FREEMONT", terms.phrases)


if __name__ == "__main__":
    unittest.main()
