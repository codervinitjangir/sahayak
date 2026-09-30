"""
Request and response shapes for job ratings.

Two endpoints use these: `POST /api/v1/jobs/{job_id}/ratings` and
`GET /api/v1/jobs/{job_id}/ratings`.

The class this module replaced had a `RatingCreate` carrying `job_id` and
`rated_by` as client-supplied fields. Both are gone, and their absence is the
point rather than a tidy-up:

  * `job_id` is in the path. A body that also carried one could disagree with
    it, and then two readers of the same request would have to agree on which
    wins.
  * `rated_by` says which side of the transaction is speaking, which is an
    identity claim. Taking it from the body would let an owner post a rating
    labelled `'partner'` — writing the mechanic's review of *themselves*, in
    the mechanic's name, and consuming the one slot the mechanic had to reply.
    It is derived from the verified token instead (core principle 5: never
    trust identity from a request body).
"""
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ratings.comment is TEXT, so this is a policy ceiling rather than the column's.
# It exists because an unbounded field on an unauthenticated-by-default shape is
# an easy way to post a megabyte; 1000 characters is more than anyone types
# about a jump start and still bounded.
MAX_COMMENT_LENGTH = 1000


class RatingCreateRequest(BaseModel):
    """One side's verdict on a finished job.

    `extra="forbid"` for the reason given in the module docstring: a client that
    sends `rated_by` is either confused about who it is or trying to be someone
    else, and both deserve a 422 rather than a 201 with the field quietly
    dropped. Same rule, and same reasoning, as `JobStatusUpdateRequest` and
    `VehicleCreateRequest`.
    """

    rating: int = Field(
        ...,
        ge=1,
        le=5,
        description="Whole stars, 1 to 5. Matches the ratings.rating CHECK constraint.",
        examples=[5],
    )
    comment: Optional[str] = Field(
        default=None,
        max_length=MAX_COMMENT_LENGTH,
        description="Optional free text. Whitespace-only is stored as null.",
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("comment")
    @classmethod
    def _blank_comment_is_absent(cls, value: Optional[str]) -> Optional[str]:
        """Normalise "" and "   " to None so one absence has one representation.

        Without this, a form that submits an untouched textarea stores an empty
        string while a client that omits the field stores NULL, and every later
        query about "did they leave a comment" has to remember to check both.
        """
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class RatingItem(BaseModel):
    """A stored rating, as returned by both endpoints.

    `rated_by` is echoed because it is the only thing in the payload that says
    which direction the rating runs: `'user'` is the owner's verdict on the
    partner, `'partner'` is the partner's verdict on the owner. Neither party's
    identity is in here — see the GET handler for why.
    """

    id: uuid.UUID
    job_id: uuid.UUID
    rated_by: Literal["user", "partner"]
    rating: int
    comment: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class JobRatingsResponse(BaseModel):
    """Every rating on one job, plus whether the caller may still add theirs.

    `ratings` is a list rather than a pair of named fields (`owner_rating`,
    `partner_rating`). A list needs no reshaping if a third kind of rater ever
    exists — an admin correction, say — and each item already names its own
    direction, so nothing is lost by not splitting them out.

    `can_rate` is the one field whose value depends on who is asking. It answers
    the question a client actually has, which is whether to render the rating
    form, and it exists so the client does not have to re-implement the server's
    rules to decide: a caller would otherwise need to know that the job must be
    completed, that each side gets one rating, and which side it is. Rules
    duplicated in a client drift from the server's, and the failure looks like a
    form that submits into a 409.
    """

    job_id: uuid.UUID
    job_status: str
    ratings: List[RatingItem]
    can_rate: bool = Field(
        ...,
        description=(
            "True when this caller may still submit a rating for this job. "
            "False once they have rated it, or while the job is not completed."
        ),
    )
