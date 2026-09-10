# Transactions

The transaction family owns the canonical transaction intermediate representation, shared
transaction VERIFY rules, and compilation to `candidate_bundle@1`. OFX and SimpleFIN remain
independent installed source definitions with stable source IDs and implementation pins.

No committed CSV source exists. “CSV” is a convention rather than a format, so a hand-written CSV
parser is really a registry of bank dialects that is never complete; every dialect belongs to the
M5 `generated_parser` path.

Child sources own format- or provider-specific capture and parsing. Nothing outside this family
interprets a transaction parser result or constructs transaction candidates.
