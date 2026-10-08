"""Phone-number comparison, in one place.

Supabase reports a token's phone claim without a leading '+' ("919000000801")
while the schema stores E.164 ("+919000000801"), so the two never compare equal
as strings even when they are the same number. Every place that has to decide
"is the number in this token the number on this row" needs the same answer, and
there are now three of them — owner registration's `phone_verified`, and both
link-auth endpoints.

Moved out of user_service when link-auth started binding on the claim. Keeping a
private copy in each service would mean three functions that have to agree about
what counts as the same number, which is the kind of thing that stays consistent
right up until one of them is changed.
"""
from typing import Optional


def digits_only(value: Optional[str]) -> str:
    """Reduce a phone number to its digits, for comparison only.

    The smallest normalisation that makes a claim and a column comparable
    without inventing a phone-number library's worth of parsing.

    Deliberately *not* used to rewrite what gets stored. A row keeps exactly what
    the client sent, so the database holds one canonical format that the client
    chose rather than a stripped variant this function invented.
    """
    return "".join(character for character in (value or "") if character.isdigit())


def same_number(claim: Optional[str], stored: Optional[str]) -> bool:
    """Do a token's phone claim and a stored phone refer to the same number?

    Exact equality on digits. Suffix matching was considered and rejected: it
    collides across country codes, since '+1 9000000801' is a suffix of
    '+91 9000000801' — and the whole point of the comparison is to decide who may
    claim a profile.

    A missing claim is never equal to anything, including a missing stored
    number. An email or OAuth sign-in carries no phone claim, so it has proved no
    number and must not be able to satisfy a check whose question is "did you
    prove this number".
    """
    claim_digits = digits_only(claim)
    stored_digits = digits_only(stored)
    if not claim_digits or not stored_digits:
        return False
    return claim_digits == stored_digits
