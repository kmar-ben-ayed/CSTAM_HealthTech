"""Drafting new rules with a language model, checked by code before anything runs.

Flow: an admin submits a rule in English -> the drafter agent writes a spec in
the rule language -> code generates edge-case claims -> an independent oracle
predicts the outcome of each case from the English text alone -> code compares
the two readings, asks the author about any disagreement, and activates the
rule only when every check passes. See docs/RULE_AUTHORING.md.
"""
