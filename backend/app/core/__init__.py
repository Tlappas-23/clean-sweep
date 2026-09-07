"""
``app.core`` — process-level infrastructure: settings and the database.

Nothing in here knows about films or ballots. The API layer imports from
this package to find out *where* the seed data lives and *how* to persist a
game; the engine never imports it at all.
"""
