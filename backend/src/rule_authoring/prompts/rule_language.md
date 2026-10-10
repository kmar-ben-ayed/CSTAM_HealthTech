# Rule language, version 2

A rule is a JSON object. The server evaluates it against one claim at a time; it is
data, never code.

```json
{
  "language_version": 2,
  "steps": [ ...steps... ],
  "messages": {
    "PASS": "shown when the rule holds",
    "FAIL": "shown when the claim breaks the rule",
    "UNABLE_TO_ASSESS": "shown when information is missing",
    "NOT_APPLICABLE": "optional; shown when the rule does not apply"
  }
}
```

## Outcomes

- **FAIL**: the claim breaks the rule (a known violation).
- **UNABLE_TO_ASSESS**: information needed to decide is missing or invalid.
- **NOT_APPLICABLE**: the rule does not apply to this claim.
- **PASS**: the rule was checked and holds.

A known violation always wins: FAIL > UNABLE_TO_ASSESS > PASS > NOT_APPLICABLE.

## Steps

Steps run in order.

| Step | Meaning |
|---|---|
| `{"need": C}` | C must be true to assess the rule. Otherwise UNABLE_TO_ASSESS, and the block stops. |
| `{"only_if": C}` | The rule applies only when C is true. False gives NOT_APPLICABLE and the block stops; unknown gives UNABLE_TO_ASSESS. It must come before any `require` or `for_each` in its block. |
| `{"require": C}` | The check itself. False gives FAIL, unknown gives UNABLE_TO_ASSESS, and the block continues. Add `"otherwise": "UNABLE_TO_ASSESS"` when a false result should mean "cannot assess" instead of FAIL. |
| `{"let": "name", "be": V}` | Names a value. Later steps read it as `{"path": "$name"}`. |
| `{"for_each": V, "as": "line", "steps": [...]}` | Runs the nested steps once per element of the list V. Element results combine as FAIL > UNABLE_TO_ASSESS > PASS; NOT_APPLICABLE elements are ignored. If every element is NOT_APPLICABLE and nothing else was checked, the rule is NOT_APPLICABLE. |

Every rule needs at least one `require`. Any step may carry `"note": "short explanation"`.

## Missing values and three-valued logic

A value is **missing** when it is absent, null, or blank text. A condition that needs a
missing value is **unknown**, not false. It is also unknown when the value has the wrong
type (text compared as a number) or is an invalid date.

- `all_of`: false if any item is false; otherwise unknown if any item is unknown; otherwise true.
- `any_of`: true if any item is true; otherwise unknown if any item is unknown; otherwise false.
- `not`: unknown stays unknown.
- `is_present` and `is_missing` are never unknown. Use them when the rule says that the
  absence of a value is itself a failure ("must be present" means `require is_present`).
- In `where` filters (`exists`, `find`, `count`, `sum`), an element matches only when its
  condition is true. Unknown counts as no match, like SQL.

If a rule says that missing information "cannot be assessed", rely on the unknown result,
or use a `need` step. If a rule says that missing information "fails", use `is_present` in
a `require`.

## Values

Each value is an object with exactly one of these keys.

| Value | Meaning |
|---|---|
| `{"path": "/currency"}` | A claim field. Nested fields: `/coverage/status`. Paths never contain list indexes. |
| `{"path": "$line/service_code"}` | A field of a named claim object (from `for_each`, `find`, `exists`, ... or `let`). |
| `{"path": "$total"}` | A named value from `let`. |
| `{"value": 10000}` | A fixed number, text or true/false. There is no null literal: use `is_missing`. |
| `{"config": "policy", "get": ["max_unit_price", {"path": "$line/service_code"}]}` | Reference data (see below). |
| `{"count": V, "as": "x", "where": C}` | The number of elements of list V (`where` is optional). |
| `{"sum": V, "as": "x", "of": V2, "where": C}` | The sum of V2 over the elements. Unknown if any V2 is missing. |
| `{"latest": V, "as": "x", "of": V2}` / `{"earliest": ...}` | The latest or earliest date. Unknown if any date is missing. |
| `{"find": V, "as": "x", "where": C}` | The first element where C is true, or missing if none. |
| `{"multiply": [A, B]}`, `{"add": [A, B, ...]}`, `{"subtract": [A, B]}` | Arithmetic. Unknown if an operand is missing. |
| `{"days_between": [FROM, TO]}` | Whole days from FROM to TO (negative if TO is earlier). |
| `{"first_present": [A, B]}` | A, or B when A is missing (a default value). |

## Conditions

Each condition has an `"op"`.

| Condition | True when |
|---|---|
| `{"op": "all_of", "items": [C...]}` / `any_of` / `{"op": "not", "item": C}` | Logic (see above). |
| `{"op": "is_present", "value": V}` / `is_missing` | V is present / missing. Never unknown. |
| `{"op": "equals", "left": A, "right": B}` / `not_equals` | Exact equality. Text is case-sensitive; numbers compare by value. |
| `less_than`, `at_most`, `greater_than`, `at_least` (left, right) | Number comparisons (`at_most` means <=). |
| `before`, `on_or_before`, `after`, `on_or_after`, `same_day` (left, right) | Date comparisons on YYYY-MM-DD dates. |
| `{"op": "within_dates", "value": D, "from": D1, "to": D2}` | D1 <= D <= D2. Unknown if any of the three dates is missing. |
| `{"op": "in", "value": V, "collection": L}` | V is in the list L, or is a key of the map L. |
| `{"op": "exists", "collection": L, "as": "x", "where": C}` | At least one element matches C. |
| `{"op": "unique", "collection": L, "as": "x", "by": [V...]}` | No two elements share the same key. Elements with a missing key part are skipped, and the result is unknown if any were skipped and no duplicate was found. |
| `{"op": "amounts_match", "left": A, "right": B, "tolerance": 0.01}` | Both amounts, rounded to cents (half up), differ by at most the tolerance (default 0.01). |
| `{"op": "is_whole_number", "value": V}` | V is a whole number. |

Comparing two fixed values is not allowed: one side must read the claim.

## Names

- A name is lowercase letters, digits or `_`, starting with a letter.
- `for_each`, `find`, `exists`, `unique`, `count`, `sum`, `latest` and `earliest` bind
  their `as` name only inside themselves.
- `let` binds a name for the rest of its block.
- A name cannot be defined twice where it is visible.

## Reference data

- `{"config": "policy", "get": [FIELD]}` reads the policy named by the claim's
  `/policy_id`. A map field can take one key: `["max_unit_price", CODE]`. If the policy is
  unknown, the value is missing.
- `{"config": "services"}` is the service catalogue, a map keyed by service code. Use
  `{"op": "in", "value": CODE, "collection": {"config": "services"}}` for "the code is
  known". `["SVC-LAB", "max_price"]` reads a field of one entry.
- `{"config": "providers"}` is the list of known provider ids.
- `{"config": "diagnoses"}` is the list of known diagnosis codes.

## Examples

These are invented rules for illustration only.

**"The claim total must not exceed 10,000. A missing total cannot be assessed."**

```json
{"language_version": 2,
 "steps": [
   {"require": {"op": "at_most", "left": {"path": "/total_amount"}, "right": {"value": 10000}},
    "note": "the claim total is at most 10,000"}],
 "messages": {"PASS": "The claim total is within 10,000.",
              "FAIL": "The claim total exceeds 10,000.",
              "UNABLE_TO_ASSESS": "The claim total is missing."}}
```

**"Every consultation line (service SVC-CONSULT) must have a modifier."**

The rule says the modifier must be present, so its absence is a failure (`is_present`). Lines
that are not consultations are not applicable, and a line without a service code cannot be
assessed.

```json
{"language_version": 2,
 "steps": [
   {"for_each": {"path": "/lines"}, "as": "line", "steps": [
     {"need": {"op": "is_present", "value": {"path": "$line/service_code"}}},
     {"only_if": {"op": "equals", "left": {"path": "$line/service_code"}, "right": {"value": "SVC-CONSULT"}}},
     {"require": {"op": "is_present", "value": {"path": "$line/modifier"}}}]}],
 "messages": {"PASS": "Every consultation line has a modifier.",
              "FAIL": "A consultation line has no modifier.",
              "UNABLE_TO_ASSESS": "A line has no service code.",
              "NOT_APPLICABLE": "The claim has no consultation lines."}}
```

**"Each line's unit price must not exceed the catalogue max_price of its service. Unknown
service codes cannot be assessed."**

```json
{"language_version": 2,
 "steps": [
   {"for_each": {"path": "/lines"}, "as": "line", "steps": [
     {"need": {"op": "in", "value": {"path": "$line/service_code"}, "collection": {"config": "services"}}},
     {"require": {"op": "at_most",
                  "left": {"path": "$line/unit_price"},
                  "right": {"config": "services", "get": [{"path": "$line/service_code"}, "max_price"]}}}]}],
 "messages": {"PASS": "All unit prices are within the catalogue maximum.",
              "FAIL": "A unit price exceeds the catalogue maximum.",
              "UNABLE_TO_ASSESS": "A service code is unknown or a unit price is missing."}}
```
