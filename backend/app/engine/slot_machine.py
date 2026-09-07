"""
The slot machine (``app.engine.slot_machine``): decade reel, then year reel.

Design
------
Drawing the decade first (uniformly over 1920s-2020s) and *then* a year
inside it keeps early cinema as likely as the streaming era even though the
2010s have ten eligible years and the 1920s only three (docs/GAME_DESIGN.md
§2). The catalog's ``[min_year, max_year]`` clips each decade to the years
that actually have pools.

Reproducibility
---------------
A game's randomness is one ``random.Random`` stream seeded with the game's
``seed`` (the daily challenge passes the date) or, failing that, the game id.
The engine is stateless between HTTP requests, so instead of pickling the
RNG we persist a single integer, ``rng_draws``, and rebuild the stream on
demand: seed, then discard that many draws (``SlotMachine.from_seed``).
Each spin consumes exactly ``DRAWS_PER_SPIN`` draws from ``rng.random()``
and nothing else, so the counter is all we need. The cost is O(draws), and a
game makes at most 8 spins, so it is negligible; the benefit is that the
stored state stays a small, human-readable JSON document.
"""

from __future__ import annotations

import random

# Every spin takes exactly this many numbers from the stream (one per reel).
DRAWS_PER_SPIN = 2

# The decade reel. Decades with no eligible year (given the catalog range)
# are dropped before drawing so the draw stays uniform over *playable* decades.
DECADE_STARTS: tuple[int, ...] = tuple(range(1920, 2030, 10))


def decade_label(year: int) -> str:
    """``1994 -> "1990s"``."""
    return f"{year // 10 * 10}s"


class SlotMachine:
    """Two reels over a seeded RNG, clipped to the catalog's year range."""

    def __init__(self, rng: random.Random, min_year: int, max_year: int) -> None:
        if min_year > max_year:
            raise ValueError("min_year must not exceed max_year")
        self.rng = rng
        self.min_year = min_year
        self.max_year = max_year
        # Precompute the eligible years of every decade once.
        self._decades: list[list[int]] = []
        for start in DECADE_STARTS:
            years = [y for y in range(start, start + 10) if min_year <= y <= max_year]
            if years:
                self._decades.append(years)

    @classmethod
    def from_seed(cls, seed: str, draws: int, min_year: int, max_year: int) -> SlotMachine:
        """
        Rebuild the machine for a game whose stream has already produced ``draws`` numbers.

        ``random.Random(str)`` seeds deterministically (the string is hashed
        with SHA-512 internally), so the same seed string always yields the
        same reel sequence on every machine and Python version >= 3.2.
        """
        rng = random.Random(seed)
        for _ in range(draws):
            rng.random()
        return cls(rng, min_year, max_year)

    def spin_year(self) -> tuple[int, str]:
        """
        Spin both reels. Returns ``(year, decade_label)``.

        Uses ``rng.random()`` exactly twice (see ``DRAWS_PER_SPIN``); the
        floats are mapped to indexes by hand rather than via ``choice`` so the
        number of stream draws is fixed and independent of list sizes.
        """
        decade_years = self._decades[int(self.rng.random() * len(self._decades))]
        year = decade_years[int(self.rng.random() * len(decade_years))]
        return year, decade_label(year)

    @property
    def decades(self) -> list[str]:
        """Labels of every playable decade, for the meta endpoint."""
        return [decade_label(years[0]) for years in self._decades]
