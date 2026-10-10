"""Measure how reliable rule authoring is, on rules whose correct behaviour is known.

The benchmark drafts each rule from its English text with the real pipeline
(drafter, oracle, checks), answers the author's questions with a simulated
author who knows the right answers, and then compares the final proposal with
a reference implementation on hundreds of claims. The key number is how often
the checks would have accepted a wrong rule.
"""
