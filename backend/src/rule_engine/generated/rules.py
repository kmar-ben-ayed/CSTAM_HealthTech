# GENERATED FILE. Do not edit manually.
"""Generated implementations in one compact registry module."""
from ..engine_core import make_result
from ..evaluator import check_spec

RULE_IMPLEMENTATIONS = {}

_SPEC_R016 = {"evidence_path": "/provider_id", "expression": {"left": "/provider_id", "op": "equals", "right": "EDU-PROV-01"}, "kind": "expression", "message": "Provider must be EDU-PROV-01.", "on_false": "FAIL", "on_missing": "FAIL", "on_true": "PASS", "schema_version": 1}
def _check_R016(claim, rule, config):
    result = check_spec(claim, rule, config, _SPEC_R016)
    return make_result(claim, rule, result['status'], result['paths'], result['message'])
RULE_IMPLEMENTATIONS['R016'] = _check_R016

_SPEC_R017 = {"evidence_path": "diagnosis_code", "expression": {"left": "diagnosis_code", "op": "equals", "right": "DX-EDU-02"}, "kind": "expression", "message": "only code 2 is accepted", "on_false": "fail", "on_missing": "fail", "on_true": "pass", "schema_version": 1}
def _check_R017(claim, rule, config):
    result = check_spec(claim, rule, config, _SPEC_R017)
    return make_result(claim, rule, result['status'], result['paths'], result['message'])
RULE_IMPLEMENTATIONS['R017'] = _check_R017
