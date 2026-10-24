# Operation coordination

Terminal outcomes are immutable history, including deleted native records.
An interrupted queued claim proves no execution; an interrupted running claim
requires reconciliation. Preserve per-profile mutation serialization and the
accepted immutable snapshot across asynchronous work.
