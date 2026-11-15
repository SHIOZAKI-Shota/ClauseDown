# Master Services Agreement
<!-- clausedown
doc: { style: contract, contractType: article }
-->

This master services agreement (the "Agreement") is made between Acme Corp. ("Customer") and Bluebird Design Studio LLC ("Provider") (each, a "Party").

## Services

### Scope of Services {#scope}
- Provider shall perform the services described in Schedule 1 (the "Services").
- The Services consist of:
  - design and production of Customer's company brochure;
  - design and production of Customer's website, including:
    - the home page and up to ten subpages; and
    - layouts adapted for smartphones; and
  - any work incidental to the foregoing.

### Definitions {#defs}
- In this Agreement:
  - "Deliverables" means all designs, files and other materials that Provider delivers to Customer as a result of the Services.
  - "Confidential Information" means any technical or business information disclosed by one Party to the other in connection with this Agreement and marked as confidential.

### Subcontracting
- Provider shall not subcontract any part of the Services without Customer's prior written consent.
- Provider remains responsible to Customer for the acts of any subcontractor approved under the preceding paragraph.

## Fees and Acceptance

### Fees {#fees}
- The fees for the Services are set out in the table below.
  ::: {size=9pt cols=22,26,52}
  | > | Category | Amount (excluding taxes) |
  |---|---|---|
  | Project fee | Brochure | $8,000 lump sum |
  | ^ | Website | $12,000 lump sum |
  | Retainer | > | $3,000 per month |
  :::
- Customer shall pay each invoice by bank transfer within 30 days after the end of the month in which it is received.

### Late Payment {#late}
- If Customer fails to pay any amount due under [[fees]] on time, Customer shall pay interest on the overdue amount calculated as follows:

  $$\text{Interest} = \text{Overdue amount} \times 0.08 \times \dfrac{\text{Days late}}{365}$$

### Acceptance {#acceptance}
- Provider shall deliver the Deliverables described in [[scope]] in the manner Customer reasonably specifies.
- Customer shall inspect each Deliverable within 10 days after delivery and notify Provider whether it is accepted or rejected, following the process below.

  ```mermaid
  flowchart LR
    A[Delivery] --> B[Inspection]
    B -->|Accepted| C[Acceptance]
    B -->|Rejected| D[Correction]
    D --> A
  ```
- If Customer gives no notice within that period, the Deliverable is deemed accepted.

## Rights and Obligations

### Ownership of Deliverables {#ip}
- All rights in the Deliverables pass from Provider to Customer upon payment of the fees under [[fees]].
- Provider waives any moral rights in the Deliverables to the extent permitted by law.

### Confidentiality {#conf}
- Each Party shall keep confidential all Confidential Information of the other Party.
- The obligations under this Article continue for three years after this Agreement ends.

### Exceptions to [[conf]]
- The obligation in [[conf:1]] does not apply to information that:
  - is publicly available when disclosed;
  - becomes publicly available through no fault of the receiving Party; or
  - is lawfully obtained from a third party without any duty of confidentiality.

### Anti-Bribery {branch}
- Each Party shall comply with all applicable anti-bribery and anti-corruption laws.

## Term and Termination

### Term {#term}
- This Agreement runs from April 1, 2026 to March 31, 2027.
- Unless either Party gives written notice at least one month before expiry, this Agreement renews for one year on the same terms, and likewise thereafter.

### Termination {#termination}
- Either Party may terminate this Agreement if the other Party breaches it and fails to cure the breach within 30 days after written notice.

### Survival
- [[ip]], [[conf:2]] and [[law]] survive the end of this Agreement.

## General

### Entire Agreement
- This Agreement is the entire agreement between the Parties about its subject matter.

### Governing Law {#law}
- This Agreement is governed by the laws of the State of New York.

## {closing}
IN WITNESS WHEREOF, the Parties have executed this Agreement as of March 20, 2026.

Acme Corp.

By: ____________

Bluebird Design Studio LLC

By: ____________

{break}
## Schedule 1 {appendix}
| Service | Details | Due date |
|---|---|---|
| Brochure | A4, 8 pages, print-ready files | June 30, 2026 |
| Website | Home page and 10 subpages | September 30, 2026 |
| Retainer | Minor changes, up to 4 a month | During the term |
