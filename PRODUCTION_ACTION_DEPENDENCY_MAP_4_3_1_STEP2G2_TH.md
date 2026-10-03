# Production Action Dependency Map — ERP 4.3.1 Step 2G-2

## Entry point

`index.html → saveProduction()`

`saveProduction()` ทำหน้าที่เพียง same-browser write lease ก่อนเข้า `saveProductionUnlocked()`

## Validate stage

`saveProductionUnlocked()`

- branch/edit-state guard
- required field validation
- `ERPIntegrity.validateItems()`
- maker lead-day validation
- cost/sale completeness validation
- date normalization
- `productionNumberExistsForWrite()` → strict scans `productions`
- edit original → `findLocalRecordForDocumentWrite('productions', ...)`
- create target pack → `createFinancialDocumentWriteSession()` หรือ `loadForFinancialDocumentWrite()`
- source Quote → strict source Quote pack + dependency existence check
- source Sales Order → `ERPOrderFlow.getStoreForFinancialWrite()` + dependency existence check

## Plan stage

`planProductionDocumentAction()`

Inputs:

- production draft จาก form/calculation
- original production (edit)
- duplicate-number result

Rules:

- required production identity
- duplicate conflict
- historical import permission guard
- Invoice-linked commercial lock
- supplier-settled commercial lock
- preserve supplier settlement fields
- preserve source Quote/SO and Invoice lineage
- initialize new production settlement/invoice state

## Commit stage — create

Local Demo:

`createFinancialDocumentWriteSession()`

- append Production ใน target pack
- patch source Quote production lineage ใน source pack
- mark touched keys
- `writeSession.commit()` → `ERPIntegrity.transaction()`

Non-local mode:

- strict target pack ถูก mutate แล้ว `saveFor()`
- `linkQuoteToChild()` ใช้ strict quote pack

## Commit stage — edit

`commitDocumentEdit('production', productionRecord)`

- strict original lookup
- strict target pack when date moves across month/year
- local-demo multi-key transaction for cross-period move
- existing Firebase edit + rollback behavior retained

## After commit

- cloud Quote workflow link best effort via `syncQuoteChildLinkCloud()`
- cloud Production save via `saveCloudRecord('saveProduction', ...)`
- supplier master remember
- clear attachments
- reset Production form
- refresh year/dashboard/list/reference controls

Failure here is `after_commit`: local core state may already be committed, so Action Runner must not tell user that the main save definitely failed.

## Supplier payment status side action

`updateProductionSupplierPaymentStatus()`

- now reads Production pack via `loadForFinancialDocumentWrite()`
- mutates settlement-owned fields
- Firebase update remains rollback-aware as before

This path remains separate from normal Production form edit; `planProductionDocumentAction()` preserves its settlement state.

## High-risk dependencies deliberately not merged into one controller

- `ERPIntegrity`
- `ERPOrderFlow`
- FirebaseService
- Product Master / Supplier Master
- Quote linkage
- Invoice linkage
- attachment persistence

Step 2G-2 creates a boundary around Production action semantics without creating a new Mega Controller.
