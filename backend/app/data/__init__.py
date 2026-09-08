"""
``app.data`` holds the read-only catalogs, loaded once at startup.

Architecture note
-----------------
"Data is a build artifact": the pipeline turns raw sources into small parquet
tables, and these classes load them into memory once. Nothing here reads a
provider or the raw IMDb dumps at request time.

    catalog.py  contenders and films for the Oscars mode, with the masking
                rules that keep the Academy outcome out of a live round
    people.py   actors, casting types and the co-star graph for the two
                side modes

Each module also owns the conversion from its internal records to the wire
shapes, so a router never assembles a payload by hand.
"""
