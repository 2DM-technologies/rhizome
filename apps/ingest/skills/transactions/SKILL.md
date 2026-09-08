# Transactions

The transaction family owns the canonical transaction intermediate representation, shared
transaction VERIFY rules, and compilation to `candidate_bundle@1`. CSV, OFX, and SimpleFIN remain
independent installed source definitions with stable source IDs and implementation pins.

Child sources own format- or provider-specific capture and parsing. Nothing outside this family
interprets a transaction parser result or constructs transaction candidates.
