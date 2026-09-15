# Product rules

## Invariants

- Feasibility is evaluated before experience ranking.
- `slack = trip window - direct travel - arrival buffer`.
- For a stop before arrival, `stop impact = route detour + parking + walking + queue + meal`.
- A pre-arrival candidate is feasible only when route detour is within the user's detour cap and stop impact is within slack.
- An after-arrival candidate does not consume pre-arrival slack, but its post-arrival meal duration must be shown separately.
- Unknown opening status is allowed only as an explicitly unverified recommendation.

## Default estimates

Use defaults only when live or user-provided values are absent:

| Item | Default |
|---|---:|
| Arrival safety buffer | 10 minutes |
| Parking | 5 minutes |
| Walking | 4 minutes |
| Queue / preparation | 8 minutes |
| Takeaway | 8 minutes |
| Snack | 10 minutes |
| Quick meal | 20 minutes |
| Sit-down meal | 45 minutes |

Defaults must remain visible in structured output so later versions can replace them with learned estimates.

## Hard-deadline purposes

Treat flights, trains, classes, exams, interviews, medical appointments, and explicit “must arrive” statements as hard deadlines. Time feasibility and uncertainty dominate cuisine match for these trips.
