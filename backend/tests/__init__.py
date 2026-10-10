import os

# Tests must not depend on (or change) the developer's real rule database in
# backend/outputs. Code that loads the rule config without naming a database
# gets a private in-memory one, seeded from rules/reference_specs.json.
# Apps built in tests always name their own temporary database explicitly.
os.environ["CLAIMGUARD_RULES_DB"] = ":memory:"
