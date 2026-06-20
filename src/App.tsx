import {
  AlertTriangle,
  Barcode,
  Boxes,
  Download,
  LayoutDashboard,
  PackagePlus,
  Pencil,
  Pill,
  Printer,
  Search,
  ScanLine,
  Settings,
  Trash2
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseBackup, serializeBackup } from "./database/repositories/backupRepository";
import { buildInventoryCsv, downloadCsv, type ReportMode } from "./reporting/csv";
import { lookupProductByUpc } from "./productLookup/upcProductLookup";
import type { ConceptSummary, MedicationForm } from "./types/domain";
import type { InventorySnapshot } from "./types/domain";
import { formatDate, parseExpirationDate } from "./utils/date";
import { normalizeProductCode } from "./database/repositories/inventoryRepository";
import { useInventory } from "./hooks/useInventory";

type Tab = "dashboard" | "manage" | "inventory" | "reports" | "settings";
type ConfirmationDetails = {
  title: string;
  rows: Array<{ label: string; value: string | number }>;
};

const medicationForms: MedicationForm[] = ["tablet", "capsule", "liquid", "topical", "other"];

type ProductOption = {
  product: {
    brand: string;
    packageName: string;
    upc: string;
  };
  concept?: {
    name: string;
    strength: string;
  };
};

const compareProductOptions = (left: ProductOption, right: ProductOption) =>
  compareText(left.concept?.name ?? "", right.concept?.name ?? "") ||
  compareText(left.concept?.strength ?? "", right.concept?.strength ?? "") ||
  compareText(left.product.brand, right.product.brand) ||
  compareText(left.product.packageName, right.product.packageName) ||
  compareText(left.product.upc, right.product.upc);

const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

const optionalNumberFromForm = (data: FormData, field: string) => {
  const value = String(data.get(field) ?? "").trim();
  return value === "" ? undefined : Number(value);
};

const formatOptionalNumber = (value: number | undefined) => value ?? "Not set";

export const App = () => {
  const { snapshot, rows, summaries, actions, message } = useInventory();
  const [tab, setTab] = useState<Tab>("dashboard");

  if (!snapshot) {
    return <main className="loading">Loading local inventory...</main>;
  }

  const lowCount = summaries.filter((summary) => summary.isLowStock).length;
  const expiringCount = rows.filter((row) => row.expirationStatus !== "ok").length;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">Local-first PWA</span>
          <h1>OTC Medication Inventory</h1>
          <p>Unopened-container tracking with expiration batches, product codes, and audit-ready reporting.</p>
        </div>
        <div className="header-metrics" aria-label="Inventory alerts">
          <Metric icon={<AlertTriangle />} label="Low stock" value={lowCount} tone={lowCount ? "danger" : "ok"} />
          <Metric icon={<Boxes />} label="Expiring" value={expiringCount} tone={expiringCount ? "warning" : "ok"} />
        </div>
      </header>

      <nav className="tab-bar" aria-label="Primary">
        <TabButton active={tab === "dashboard"} icon={<LayoutDashboard />} label="Dashboard" onClick={() => setTab("dashboard")} />
        <TabButton active={tab === "manage"} icon={<PackagePlus />} label="Add" onClick={() => setTab("manage")} />
        <TabButton active={tab === "inventory"} icon={<Boxes />} label="Inventory" onClick={() => setTab("inventory")} />
        <TabButton active={tab === "reports"} icon={<Printer />} label="Reports" onClick={() => setTab("reports")} />
        <TabButton active={tab === "settings"} icon={<Settings />} label="Settings" onClick={() => setTab("settings")} />
      </nav>

      {message ? <div className="toast" role="status">{message}</div> : null}

      {tab === "dashboard" && <Dashboard summaries={summaries} rows={rows} />}
      {tab === "manage" && (
        <Manage
          snapshot={snapshot}
          scan={actions.scan}
          addConcept={actions.addConcept}
          updateConcept={actions.updateConcept}
          addProduct={actions.addProduct}
          updateProduct={actions.updateProduct}
          removeProductFromSelection={actions.removeProductFromSelection}
          addBatch={actions.addBatch}
        />
      )}
      {tab === "inventory" && <Inventory rows={rows} updateBatchCount={actions.updateBatchCount} removeOneContainer={actions.removeOneContainer} />}
      {tab === "reports" && <Reports rows={rows} summaries={summaries} />}
      {tab === "settings" && (
        <SettingsView
          snapshot={snapshot}
          deleteDeprecatedProducts={actions.deleteDeprecatedProducts}
          exportBackup={actions.exportBackup}
          importBackup={actions.importBackup}
          updateSettings={actions.updateSettings}
        />
      )}
    </main>
  );
};

const Metric = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "danger" | "warning" | "ok" }) => (
  <div className={`metric metric-${tone}`}>
    {icon}
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const TabButton = ({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) => (
  <button className={active ? "tab active" : "tab"} onClick={onClick} type="button" title={label}>
    {icon}
    <span>{label}</span>
  </button>
);

const Dashboard = ({ summaries, rows }: Pick<ReturnType<typeof useInventory>, "summaries" | "rows">) => {
  const problemRows = rows.filter((row) => row.expirationStatus !== "ok").slice(0, 6);

  return (
    <section className="content-grid">
      <div className="panel wide">
        <h2>Concept Status</h2>
        <div className="summary-grid">
          {summaries.length ? (
            summaries.map((summary) => (
              <article className={`summary-card status-${summary.status}`} key={summary.concept.id}>
                <div>
                  <strong>{summary.concept.name}</strong>
                  <span>{summary.concept.strength} · {summary.concept.form}</span>
                </div>
                <b>{summary.totalQuantity}</b>
                <small>
                  {summary.containerCount} unopened containers ·{" "}
                  {summary.concept.isActive === false
                    ? "deprecated"
                    : `reorder at ${summary.concept.reorderPoint} · amount ${formatOptionalNumber(summary.concept.reorderAmount)}`}
                </small>
              </article>
            ))
          ) : (
            <EmptyState text="Add an inventory concept to start tracking stock." />
          )}
        </div>
      </div>
      <div className="panel">
        <h2>Expiration Watch</h2>
        <div className="stack">
          {problemRows.length ? problemRows.map((row) => <BatchLine key={row.batch.id} row={row} />) : <EmptyState text="No expired or warning batches." />}
        </div>
      </div>
    </section>
  );
};

const Manage = ({
  snapshot,
  scan,
  addConcept,
  updateConcept,
  addProduct,
  updateProduct,
  removeProductFromSelection,
  addBatch
}: { snapshot: InventorySnapshot } & {
  scan: () => Promise<string>;
  addConcept: ReturnType<typeof useInventory>["actions"]["addConcept"];
  updateConcept: ReturnType<typeof useInventory>["actions"]["updateConcept"];
  addProduct: ReturnType<typeof useInventory>["actions"]["addProduct"];
  updateProduct: ReturnType<typeof useInventory>["actions"]["updateProduct"];
  removeProductFromSelection: ReturnType<typeof useInventory>["actions"]["removeProductFromSelection"];
  addBatch: ReturnType<typeof useInventory>["actions"]["addBatch"];
}) => {
  const [upc, setUpc] = useState("");
  const [isLookingUpProduct, setIsLookingUpProduct] = useState(false);
  const [productLookupMessage, setProductLookupMessage] = useState("");
  const [productDraft, setProductDraft] = useState({
    brand: "",
    packageName: "",
    packageQuantity: "100",
    unitLabel: ""
  });
  const [isLookingUpSelectedProduct, setIsLookingUpSelectedProduct] = useState(false);
  const [selectedProductLookupMessage, setSelectedProductLookupMessage] = useState("");
  const [selectedProductDraft, setSelectedProductDraft] = useState({
    upc: "",
    brand: "",
    packageName: "",
    packageQuantity: "",
    unitLabel: ""
  });
  const [selectedConceptId, setSelectedConceptId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationDetails | undefined>();

  const activeConcepts = snapshot.concepts.filter((concept) => concept.isActive !== false);
  const selectedConcept = snapshot.concepts.find((concept) => concept.id === selectedConceptId);
  const selectedProduct = snapshot.products.find((product) => product.id === selectedProductId);
  const productOptions = snapshot.products.map((product) => ({
    product,
    concept: snapshot.concepts.find((concept) => concept.id === product.conceptId)
  })).sort(compareProductOptions);
  const activeProductOptions = productOptions.filter(({ product, concept }) => product.isActive !== false && concept?.isActive !== false);

  const handleScan = async () => {
    const scanned = await scan();
    if (scanned) setUpc(scanned);
  };

  const handleProductLookup = async () => {
    setIsLookingUpProduct(true);
    setProductLookupMessage("");

    try {
      const result = await lookupProductByUpc(upc);
      setUpc(result.upc);
      setProductDraft({
        brand: result.brand,
        packageName: result.packageName,
        packageQuantity: String(result.packageQuantity),
        unitLabel: result.unitLabel
      });
      setProductLookupMessage(`Filled from ${result.source}. Review before saving.`);
    } catch (error) {
      setProductLookupMessage(error instanceof Error ? error.message : "Product lookup failed.");
    } finally {
      setIsLookingUpProduct(false);
    }
  };

  const updateProductDraft = (field: keyof typeof productDraft, value: string) => {
    setProductDraft((draft) => ({ ...draft, [field]: value }));
  };

  useEffect(() => {
    setSelectedProductLookupMessage("");
    setSelectedProductDraft({
      upc: selectedProduct?.upc ?? "",
      brand: selectedProduct?.brand ?? "",
      packageName: selectedProduct?.packageName ?? "",
      packageQuantity: selectedProduct ? String(selectedProduct.packageQuantity) : "",
      unitLabel: selectedProduct?.unitLabel ?? ""
    });
  }, [selectedProduct]);

  const updateSelectedProductDraft = (field: keyof typeof selectedProductDraft, value: string) => {
    setSelectedProductDraft((draft) => ({ ...draft, [field]: value }));
  };

  const handleSelectedProductScan = async () => {
    const scanned = await scan();
    if (scanned) updateSelectedProductDraft("upc", scanned);
  };

  const handleSelectedProductLookup = async () => {
    setIsLookingUpSelectedProduct(true);
    setSelectedProductLookupMessage("");

    try {
      const result = await lookupProductByUpc(selectedProductDraft.upc);
      setSelectedProductDraft((draft) => ({
        ...draft,
        upc: result.upc,
        brand: result.brand,
        packageName: result.packageName,
        packageQuantity: String(result.packageQuantity),
        unitLabel: result.unitLabel
      }));
      setSelectedProductLookupMessage(`Filled from ${result.source}. Review before saving.`);
    } catch (error) {
      setSelectedProductLookupMessage(error instanceof Error ? error.message : "Product lookup failed.");
    } finally {
      setIsLookingUpSelectedProduct(false);
    }
  };

  return (
    <section className="content-grid">
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const concept = await addConcept({
            name: String(data.get("name")),
            strength: String(data.get("strength")),
            form: String(data.get("form")) as MedicationForm,
            reorderPoint: Number(data.get("reorderPoint")),
            reorderAmount: optionalNumberFromForm(data, "reorderAmount"),
            isActive: true,
            notes: String(data.get("notes") || "")
          });
          if (!concept) return;
          setConfirmation({
            title: "Concept added",
            rows: [
              { label: "Concept", value: concept.name },
              { label: "Strength", value: concept.strength },
              { label: "Form", value: concept.form },
              { label: "Reorder point", value: concept.reorderPoint },
              { label: "Reorder amount", value: formatOptionalNumber(concept.reorderAmount) },
              { label: "Status", value: concept.isActive === false ? "Deprecated" : "Reorder active" },
              { label: "Notes", value: concept.notes || "None" }
            ]
          });
          form.reset();
        }}
      >
        <h2><Pill /> Concept</h2>
        <Input name="name" label="Medication concept" required placeholder="Ibuprofen" />
        <Input name="strength" label="Strength" required placeholder="200 mg" />
        <label>
          Form
          <select name="form" required>
            {medicationForms.map((form) => <option key={form}>{form}</option>)}
          </select>
        </label>
        <Input name="reorderPoint" label="Reorder point" required type="number" min="0" step="any" defaultValue="100" />
        <Input name="reorderAmount" label="Reorder amount" type="number" min="0" step="any" />
        <label>
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <button className="primary" type="submit">Save concept</button>
      </form>

      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const concept = snapshot.concepts.find((item) => item.id === String(data.get("conceptId")));
          const product = await addProduct({
            conceptId: String(data.get("conceptId")),
            upc: normalizeProductCode(String(data.get("upc"))),
            brand: String(data.get("brand")),
            packageName: String(data.get("packageName")),
            packageQuantity: Number(data.get("packageQuantity")),
            unitLabel: String(data.get("unitLabel"))
          });
          if (!product) return;
          setConfirmation({
            title: "Product added",
            rows: [
              { label: "Concept", value: concept ? `${concept.name} ${concept.strength}` : "Unknown" },
              { label: "Brand", value: product.brand },
              { label: "Package", value: product.packageName },
              { label: "Product code", value: product.upc },
              { label: "Package quantity", value: product.packageQuantity },
              { label: "Unit label", value: product.unitLabel }
            ]
          });
          form.reset();
          setUpc("");
          setProductDraft({ brand: "", packageName: "", packageQuantity: "100", unitLabel: "" });
          setProductLookupMessage("");
        }}
      >
        <h2><Barcode /> Product</h2>
        <label>
          Concept
          <select name="conceptId" required>
            <option value="">Choose concept</option>
            {activeConcepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name} · {concept.strength}</option>)}
          </select>
        </label>
        <div className="scan-row">
          <Input name="upc" label="Product code" required value={upc} onChange={(event) => setUpc(event.target.value)} />
          <button type="button" className="icon-button" onClick={handleScan} title="Scan product code"><ScanLine /></button>
          <button
            type="button"
            className="icon-button"
            disabled={isLookingUpProduct}
            onClick={handleProductLookup}
            title="Look up numeric UPC/EAN"
          >
            <Search />
          </button>
        </div>
        {productLookupMessage ? <p className="form-note">{productLookupMessage}</p> : null}
        <Input
          name="brand"
          label="Brand"
          required
          placeholder="Kirkland"
          value={productDraft.brand}
          onChange={(event) => updateProductDraft("brand", event.target.value)}
        />
        <Input
          name="packageName"
          label="Package name"
          required
          placeholder="Ibuprofen 200 mg tablets"
          value={productDraft.packageName}
          onChange={(event) => updateProductDraft("packageName", event.target.value)}
        />
        <Input
          name="packageQuantity"
          label="Package quantity"
          required
          type="number"
          min="0"
          step="any"
          value={productDraft.packageQuantity}
          onChange={(event) => updateProductDraft("packageQuantity", event.target.value)}
        />
        <Input
          name="unitLabel"
          label="Unit label"
          required
          placeholder="tablets"
          value={productDraft.unitLabel}
          onChange={(event) => updateProductDraft("unitLabel", event.target.value)}
        />
        <button className="primary" type="submit">Save product</button>
      </form>

      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const productOption = activeProductOptions.find(({ product }) => product.id === String(data.get("productId")));
          const addedContainers = Number(data.get("containerCount"));
          const expirationDate = parseExpirationDate(String(data.get("expirationDate")));
          const batch = await addBatch({
            productId: String(data.get("productId")),
            expirationDate,
            containerCount: addedContainers
          });
          if (!batch) return;
          setConfirmation({
            title: "Batch saved",
            rows: [
              { label: "Concept", value: productOption?.concept?.name ?? "Unknown" },
              { label: "Brand", value: productOption?.product.brand ?? "Unknown" },
              { label: "Strength", value: productOption?.concept?.strength ?? "Unknown" },
              { label: "Expiration", value: formatDate(batch.expirationDate) },
              { label: "Containers added", value: addedContainers },
              { label: "Current containers", value: batch.containerCount }
            ]
          });
          form.reset();
        }}
      >
        <h2><Boxes /> Batch</h2>
        <label>
          Product
          <select name="productId" required>
            <option value="">Choose product</option>
            {activeProductOptions.map(({ product, concept }) => (
              <option key={product.id} value={product.id}>{concept?.name ?? "Unknown"} · {product.brand} · {concept?.strength ?? "Unknown strength"}</option>
            ))}
          </select>
        </label>
        <Input name="expirationDate" label="Expiration date" required placeholder="YYYY-MM-DD, MM/DD/YYYY, or MM/YYYY" />
        <Input name="containerCount" label="Unopened containers" required type="number" min="0" defaultValue="1" />
        <button className="primary" type="submit">Save batch</button>
      </form>

      <section className="panel concept-maintenance">
        <h2><Pencil /> Concept Policies</h2>
        {snapshot.concepts.length ? (
          <>
            <label>
              Concept to edit
              <select value={selectedConceptId} onChange={(event) => setSelectedConceptId(event.target.value)}>
                <option value="">Choose concept</option>
                {snapshot.concepts.map((concept) => (
                  <option key={concept.id} value={concept.id}>
                    {concept.name} · {concept.strength}{concept.isActive === false ? " · deprecated" : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedConcept ? (
              <form
                className="concept-edit-form"
                key={selectedConcept.id}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const concept = await updateConcept(selectedConcept.id, {
                    name: String(data.get("name")),
                    strength: String(data.get("strength")),
                    form: String(data.get("form")) as MedicationForm,
                    reorderPoint: Number(data.get("reorderPoint")),
                    reorderAmount: optionalNumberFromForm(data, "reorderAmount"),
                    isActive: data.get("isActive") === "on",
                    notes: String(data.get("notes") || "")
                  });
                  if (!concept) return;
                  setConfirmation({
                    title: "Concept policy updated",
                    rows: [
                      { label: "Concept", value: concept.name },
                      { label: "Strength", value: concept.strength },
                      { label: "Form", value: concept.form },
                      { label: "Reorder point", value: concept.reorderPoint },
                      { label: "Reorder amount", value: formatOptionalNumber(concept.reorderAmount) },
                      { label: "Status", value: concept.isActive === false ? "Deprecated" : "Reorder active" },
                      { label: "Notes", value: concept.notes || "None" }
                    ]
                  });
                }}
              >
                <Input name="name" label="Concept name" required defaultValue={selectedConcept.name} />
                <Input name="strength" label="Strength" required defaultValue={selectedConcept.strength} />
                <label>
                  Form
                  <select name="form" required defaultValue={selectedConcept.form}>
                    {medicationForms.map((form) => <option key={form}>{form}</option>)}
                  </select>
                </label>
                <Input name="reorderPoint" label="Reorder point" required type="number" min="0" step="any" defaultValue={selectedConcept.reorderPoint} />
                <Input name="reorderAmount" label="Reorder amount" type="number" min="0" step="any" defaultValue={selectedConcept.reorderAmount ?? ""} />
                <label className="checkbox-field">
                  <input name="isActive" type="checkbox" defaultChecked={selectedConcept.isActive !== false} />
                  Reorder active
                </label>
                <label className="concept-notes">
                  Notes
                  <textarea name="notes" rows={2} defaultValue={selectedConcept.notes ?? ""} />
                </label>
                <button className="secondary compact" type="submit">Save changes</button>
              </form>
            ) : (
              <EmptyState text="Choose a concept to edit reorder policy or corrections." />
            )}
          </>
        ) : (
          <EmptyState text="No concepts to edit yet." />
        )}
      </section>

      <section className="panel product-maintenance">
        <h2><Barcode /> Product Maintenance</h2>
        {snapshot.products.length ? (
          <>
            <label>
              Product to edit
              <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                <option value="">Choose product</option>
                {productOptions.map(({ product, concept }) => {
                  return (
                    <option key={product.id} value={product.id}>
                      {concept?.name ?? "Unknown"} · {product.brand} · {concept?.strength ?? "Unknown strength"}{product.isActive === false ? " · removed" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            {selectedProduct ? (
              <form
                className="product-edit-form"
                key={selectedProduct.id}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const product = await updateProduct(selectedProduct.id, {
                    conceptId: String(data.get("conceptId")),
                    upc: normalizeProductCode(String(data.get("upc"))),
                    brand: String(data.get("brand")),
                    packageName: String(data.get("packageName")),
                    packageQuantity: Number(data.get("packageQuantity")),
                    unitLabel: String(data.get("unitLabel")),
                    isActive: data.get("isActive") === "on"
                  });
                  if (!product) return;
                  const concept = snapshot.concepts.find((item) => item.id === product.conceptId);
                  setConfirmation({
                    title: "Product updated",
                    rows: [
                      { label: "Concept", value: concept ? `${concept.name} ${concept.strength}` : "Unknown" },
                      { label: "Brand", value: product.brand },
                      { label: "Package", value: product.packageName },
                      { label: "Product code", value: product.upc },
                      { label: "Package quantity", value: product.packageQuantity },
                      { label: "Unit label", value: product.unitLabel },
                      { label: "Availability", value: product.isActive === false ? "Removed from new batches" : "Available for new batches" }
                    ]
                  });
                }}
              >
                <label>
                  Concept
                  <select name="conceptId" required defaultValue={selectedProduct.conceptId}>
                    {snapshot.concepts.map((concept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.name} · {concept.strength}{concept.isActive === false ? " · deprecated" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="scan-row">
                  <Input
                    name="upc"
                    label="Product code"
                    required
                    value={selectedProductDraft.upc}
                    onChange={(event) => updateSelectedProductDraft("upc", event.target.value)}
                  />
                  <button type="button" className="icon-button" onClick={handleSelectedProductScan} title="Scan product code"><ScanLine /></button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={isLookingUpSelectedProduct}
                    onClick={handleSelectedProductLookup}
                    title="Look up numeric UPC/EAN"
                  >
                    <Search />
                  </button>
                </div>
                {selectedProductLookupMessage ? <p className="form-note">{selectedProductLookupMessage}</p> : null}
                <Input
                  name="brand"
                  label="Brand"
                  required
                  value={selectedProductDraft.brand}
                  onChange={(event) => updateSelectedProductDraft("brand", event.target.value)}
                />
                <Input
                  name="packageName"
                  label="Package name"
                  required
                  value={selectedProductDraft.packageName}
                  onChange={(event) => updateSelectedProductDraft("packageName", event.target.value)}
                />
                <Input
                  name="packageQuantity"
                  label="Package quantity"
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={selectedProductDraft.packageQuantity}
                  onChange={(event) => updateSelectedProductDraft("packageQuantity", event.target.value)}
                />
                <Input
                  name="unitLabel"
                  label="Unit label"
                  required
                  value={selectedProductDraft.unitLabel}
                  onChange={(event) => updateSelectedProductDraft("unitLabel", event.target.value)}
                />
                <label className="checkbox-field">
                  <input name="isActive" type="checkbox" defaultChecked={selectedProduct.isActive !== false} />
                  Available for new batches
                </label>
                <button className="secondary compact" type="submit">Save changes</button>
              </form>
            ) : (
              <EmptyState text="Choose a product to edit details or restore availability." />
            )}
          </>
        ) : (
          <EmptyState text="No products to edit yet." />
        )}
        <h2 className="subsection-heading"><Trash2 /> Product Selection</h2>
        <div className="product-list">
          {activeProductOptions.length ? (
            activeProductOptions.map(({ product, concept }) => (
              <article className="product-row" key={product.id}>
                <div>
                  <strong>{product.brand}</strong>
                  <span>{concept?.name ?? "Unknown"} · {product.packageName}</span>
                  <small>Code {product.upc}</small>
                </div>
                <button
                  className="secondary compact danger-action"
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove ${product.brand} from new batch selection? Existing inventory records will stay visible.`)) {
                      void removeProductFromSelection(product.id);
                    }
                  }}
                >
                  Remove
                </button>
              </article>
            ))
          ) : (
            <EmptyState text="No active products in the batch picker." />
          )}
        </div>
      </section>
      {confirmation ? <ConfirmationDialog details={confirmation} onClose={() => setConfirmation(undefined)} /> : null}
    </section>
  );
};

const ConfirmationDialog = ({ details, onClose }: { details: ConfirmationDetails; onClose: () => void }) => (
  <div className="dialog-backdrop" role="presentation">
    <section aria-labelledby="confirmation-title" aria-modal="true" className="confirmation-dialog" role="dialog">
      <h2 id="confirmation-title">{details.title}</h2>
      <dl>
        {details.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <button autoFocus className="primary" onClick={onClose} type="button">OK</button>
    </section>
  </div>
);

const Inventory = ({
  rows,
  updateBatchCount,
  removeOneContainer,
  readOnly = false
}: Pick<ReturnType<typeof useInventory>, "rows"> & {
  updateBatchCount: ReturnType<typeof useInventory>["actions"]["updateBatchCount"];
  removeOneContainer?: ReturnType<typeof useInventory>["actions"]["removeOneContainer"];
  readOnly?: boolean;
}) => {
  const [confirmation, setConfirmation] = useState<ConfirmationDetails | undefined>();

  return (
    <section className="panel wide">
      <h2>Inventory Batches</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Concept</th>
              <th>Product</th>
              <th>Expiration</th>
              <th>Containers</th>
              <th>Total qty</th>
              {readOnly ? <th>Reorder amount</th> : null}
              {!readOnly ? <th>Use</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.batch.id}>
                <td>{row.concept.name}<span>{row.concept.strength}</span></td>
                <td>{row.product.brand}<span>{row.product.upc}</span></td>
                <td>{formatDate(row.batch.expirationDate)}</td>
                <td>
                  <input
                    aria-label={`Containers for ${row.product.brand}`}
                    disabled={readOnly}
                    key={`${row.batch.id}-${row.batch.containerCount}`}
                    min="0"
                    type="number"
                    defaultValue={row.batch.containerCount}
                    onBlur={(event) => void updateBatchCount(row.batch.id, Number(event.target.value))}
                  />
                </td>
                <td>{row.totalQuantity} {row.product.unitLabel}</td>
                {readOnly ? <td>{formatOptionalNumber(row.concept.reorderAmount)}</td> : null}
                {!readOnly ? (
                  <td>
                    <button
                      className="secondary compact"
                      type="button"
                      onClick={async () => {
                        const remainingContainers = await removeOneContainer?.(row.batch.id);
                        if (remainingContainers === undefined) return;
                        setConfirmation({
                          title: "Container removed",
                          rows: [
                            { label: "Concept", value: row.concept.name },
                            { label: "Product", value: row.product.brand },
                            { label: "Expiration", value: formatDate(row.batch.expirationDate) },
                            { label: "Remaining containers", value: remainingContainers }
                          ]
                        });
                      }}
                      title="Remove one unopened container from this batch"
                    >
                      Take one
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <EmptyState text="No inventory batches yet." /> : null}
      </div>
      {confirmation ? <ConfirmationDialog details={confirmation} onClose={() => setConfirmation(undefined)} /> : null}
    </section>
  );
};

const Reports = ({ rows, summaries }: Pick<ReturnType<typeof useInventory>, "rows" | "summaries">) => {
  const generatedAt = useMemo(() => new Date().toLocaleString(), []);
  const [reportMode, setReportMode] = useState<ReportMode>("all");
  const reorderSummaries = summaries.filter((summary) => summary.isLowStock);
  const reportSummaries = reportMode === "reorder" ? reorderSummaries : summaries;
  const csvFilename = reportMode === "reorder" ? "otc-reorder-report.csv" : "otc-inventory-report.csv";

  return (
    <section className={`panel wide report-panel report-mode-${reportMode}`}>
      <div className="report-toolbar">
        <h2>Audit Report</h2>
        <div>
          <button type="button" onClick={() => downloadCsv(csvFilename, buildInventoryCsv(reportSummaries, rows, reportMode))}><Download /> CSV</button>
          <button type="button" onClick={() => window.print()}><Printer /> Print</button>
        </div>
      </div>
      <fieldset className="report-mode-control">
        <legend>Report format</legend>
        <label>
          <input
            checked={reportMode === "all"}
            name="reportMode"
            onChange={() => setReportMode("all")}
            type="radio"
          />
          All items
        </label>
        <label>
          <input
            checked={reportMode === "reorder"}
            name="reportMode"
            onChange={() => setReportMode("reorder")}
            type="radio"
          />
          Reorder only
        </label>
      </fieldset>
      <p className="muted">Generated {generatedAt}. Opened containers are excluded by design.</p>
      {reportMode === "reorder" ? (
        <ReorderReport summaries={reorderSummaries} />
      ) : (
        <>
          <ConceptReport summaries={summaries} />
          <Inventory rows={rows} updateBatchCount={async () => undefined} readOnly />
        </>
      )}
    </section>
  );
};

const ReorderReport = ({ summaries }: { summaries: ConceptSummary[] }) => (
  <section className="report-section reorder-report">
    <h2>Reorder Needed</h2>
    <div className="table-wrap">
      <table className="reorder-table">
        <thead>
          <tr>
            <th className="report-priority-column">Concept</th>
            <th>Quantity</th>
            <th className="report-priority-column">Reorder Quantity</th>
            <th>Containers</th>
            <th>Soonest Expiration</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={summary.concept.id}>
              <td className="report-priority-column">{summary.concept.name}<span>{summary.concept.strength}</span></td>
              <td>{summary.totalQuantity}</td>
              <td className="report-priority-column">{formatOptionalNumber(summary.concept.reorderAmount)}</td>
              <td>{summary.containerCount}</td>
              <td>{summary.soonestExpiration ? formatDate(summary.soonestExpiration) : "No stock"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!summaries.length ? <EmptyState text="No active concepts currently need reordering." /> : null}
    </div>
  </section>
);

const ConceptReport = ({ summaries }: { summaries: ConceptSummary[] }) => (
  <section className="report-section">
    <h2>Concept Reorder Status</h2>
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Concept</th>
            <th>Status</th>
            <th>Total qty</th>
            <th>Reorder point</th>
            <th>Reorder amount</th>
            <th>Containers</th>
            <th>Soonest expiration</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={summary.concept.id}>
              <td>{summary.concept.name}<span>{summary.concept.strength} · {summary.concept.form}</span></td>
              <td><span className={`badge ${summary.status}`}>{conceptStatusLabel(summary)}</span></td>
              <td>{summary.totalQuantity}</td>
              <td>{summary.concept.reorderPoint}</td>
              <td>{formatOptionalNumber(summary.concept.reorderAmount)}</td>
              <td>{summary.containerCount}</td>
              <td>{summary.soonestExpiration ? formatDate(summary.soonestExpiration) : "No stock"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!summaries.length ? <EmptyState text="No concepts to report yet." /> : null}
    </div>
  </section>
);

const conceptStatusLabel = (summary: ConceptSummary) => (summary.isLowStock ? "reorder" : summary.status);

const SettingsView = ({
  snapshot,
  deleteDeprecatedProducts,
  exportBackup,
  importBackup,
  updateSettings
}: { snapshot: InventorySnapshot } & {
  deleteDeprecatedProducts: ReturnType<typeof useInventory>["actions"]["deleteDeprecatedProducts"];
  exportBackup: ReturnType<typeof useInventory>["actions"]["exportBackup"];
  importBackup: ReturnType<typeof useInventory>["actions"]["importBackup"];
  updateSettings: ReturnType<typeof useInventory>["actions"]["updateSettings"];
}) => {
  const [pendingDeletedProducts, setPendingDeletedProducts] = useState<DeprecatedProductOption[]>([]);
  const [confirmation, setConfirmation] = useState<ConfirmationDetails | undefined>();
  const [backupMessage, setBackupMessage] = useState("");
  const [pendingBackupText, setPendingBackupText] = useState("");
  const [pastedBackupText, setPastedBackupText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchProductIds = useMemo(() => new Set(snapshot.batches.map((batch) => batch.productId)), [snapshot.batches]);
  const deprecatedProductOptions = useMemo(
    () =>
      snapshot.products
        .filter((product) => product.isActive === false && !batchProductIds.has(product.id))
        .map((product) => ({
          product,
          concept: snapshot.concepts.find((concept) => concept.id === product.conceptId)
        }))
        .sort(compareProductOptions),
    [batchProductIds, snapshot.concepts, snapshot.products]
  );

  const describeProduct = ({ product, concept }: DeprecatedProductOption) =>
    `${concept?.name ?? "Unknown concept"} ${concept?.strength ?? ""} - ${product.brand} (${product.upc})`;

  const createBackupFilename = () => `otc-inventory-backup-${new Date().toISOString().slice(0, 10)}.json`;

  const handleDownloadBackup = async () => {
    const backup = await exportBackup();
    const blob = new Blob([serializeBackup(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createBackupFilename();
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage("Backup file created.");
  };

  const handleCopyBackup = async () => {
    try {
      const backup = await exportBackup();
      await navigator.clipboard.writeText(serializeBackup(backup));
      setBackupMessage("Backup JSON copied to clipboard.");
    } catch {
      setBackupMessage("Clipboard copy was blocked. Use Download backup instead.");
    }
  };

  const handleBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      parseBackup(text);
      setPendingBackupText(text);
      setBackupMessage(`Ready to restore ${file.name}.`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Backup file could not be read.");
    }
  };

  const handleRestoreBackup = async () => {
    try {
      const backup = parseBackup(pendingBackupText);
      await importBackup(backup);
      setPendingBackupText("");
      setPastedBackupText("");
      setBackupMessage("Backup restored. Inventory data has been refreshed.");
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Backup restore failed.");
    }
  };

  return (
    <section className="panel">
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void updateSettings({
            expirationWarningDays: Number(data.get("expirationWarningDays")),
            scannerMode: String(data.get("scannerMode")) as "mock" | "browser"
          });
        }}
      >
        <h2>Settings</h2>
        <Input name="expirationWarningDays" label="Expiration warning days" type="number" min="1" defaultValue={snapshot.settings.expirationWarningDays} />
        <label>
          Scanner mode
          <select name="scannerMode" defaultValue={snapshot.settings.scannerMode}>
            <option value="mock">Mock scanner</option>
            <option value="browser">Browser camera scanner</option>
          </select>
        </label>
        <button className="primary" type="submit">Save settings</button>
      </form>

      <div className="settings-maintenance">
        <h2><Download /> Backup & Restore</h2>
        <p className="form-note">
          Export this browser's local data before changing devices or URLs. Restore replaces the current inventory data.
        </p>
        <div className="backup-actions">
          <button className="secondary compact" onClick={() => void handleDownloadBackup()} type="button">
            Download backup
          </button>
          <button className="secondary compact" onClick={() => void handleCopyBackup()} type="button">
            Copy backup
          </button>
          <button className="secondary compact" onClick={() => fileInputRef.current?.click()} type="button">
            Choose backup file
          </button>
        </div>
        <input
          accept="application/json,.json"
          className="hidden-file-input"
          onChange={(event) => void handleBackupFile(event)}
          ref={fileInputRef}
          type="file"
        />
        {backupMessage ? <p className="form-note">{backupMessage}</p> : null}
        <label>
          Paste backup JSON
          <textarea
            rows={5}
            value={pastedBackupText}
            onChange={(event) => setPastedBackupText(event.target.value)}
            placeholder="Paste copied backup JSON here, then restore."
          />
        </label>
        <button
          className="secondary compact"
          disabled={!pastedBackupText.trim()}
          onClick={() => {
            try {
              parseBackup(pastedBackupText);
              setPendingBackupText(pastedBackupText);
              setBackupMessage("Ready to restore pasted backup.");
            } catch (error) {
              setBackupMessage(error instanceof Error ? error.message : "Backup JSON could not be read.");
            }
          }}
          type="button"
        >
          Restore pasted backup
        </button>
      </div>

      <div className="settings-maintenance">
        <h2>Maintenance</h2>
        <p className="form-note">
          Delete products that were removed from new batch selection and have no inventory batches.
        </p>
        <button
          className="secondary compact danger-action"
          disabled={!deprecatedProductOptions.length}
          onClick={() => setPendingDeletedProducts(deprecatedProductOptions)}
          type="button"
        >
          Delete deprecated products
        </button>
        {!deprecatedProductOptions.length ? <p className="form-note">No deprecated products are eligible for deletion.</p> : null}
      </div>

      {pendingDeletedProducts.length ? (
        <DeleteDeprecatedProductsDialog
          products={pendingDeletedProducts}
          describeProduct={describeProduct}
          onCancel={() => setPendingDeletedProducts([])}
          onConfirm={async () => {
            const deletedProducts = await deleteDeprecatedProducts(pendingDeletedProducts.map(({ product }) => product.id));
            setPendingDeletedProducts([]);
            if (!deletedProducts) return;
            setConfirmation({
              title: "Deprecated products deleted",
              rows: deletedProducts.length
                ? deletedProducts.map((product, index) => ({ label: `Product ${index + 1}`, value: `${product.brand} (${product.upc})` }))
                : [{ label: "Deleted", value: 0 }]
            });
          }}
        />
      ) : null}
      {pendingBackupText ? (
        <RestoreBackupDialog
          onCancel={() => setPendingBackupText("")}
          onConfirm={handleRestoreBackup}
        />
      ) : null}
      {confirmation ? <ConfirmationDialog details={confirmation} onClose={() => setConfirmation(undefined)} /> : null}
    </section>
  );
};

type DeprecatedProductOption = ProductOption & {
  product: ProductOption["product"] & { id: string };
};

const DeleteDeprecatedProductsDialog = ({
  products,
  describeProduct,
  onCancel,
  onConfirm
}: {
  products: DeprecatedProductOption[];
  describeProduct: (product: DeprecatedProductOption) => string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) => (
  <div className="dialog-backdrop" role="presentation">
    <section aria-labelledby="delete-products-title" aria-modal="true" className="confirmation-dialog" role="dialog">
      <h2 id="delete-products-title">Delete deprecated products?</h2>
      <dl>
        {products.map((product, index) => (
          <div key={product.product.id}>
            <dt>Product {index + 1}</dt>
            <dd>{describeProduct(product)}</dd>
          </div>
        ))}
      </dl>
      <div className="dialog-actions">
        <button className="secondary compact" onClick={onCancel} type="button">Cancel</button>
        <button autoFocus className="primary danger-action" onClick={() => void onConfirm()} type="button">Delete products</button>
      </div>
    </section>
  </div>
);

const RestoreBackupDialog = ({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) => (
  <div className="dialog-backdrop" role="presentation">
    <section aria-labelledby="restore-backup-title" aria-modal="true" className="confirmation-dialog" role="dialog">
      <h2 id="restore-backup-title">Restore backup?</h2>
      <p className="form-note">This will replace all concepts, products, batches, and settings currently stored at this URL.</p>
      <div className="dialog-actions">
        <button className="secondary compact" onClick={onCancel} type="button">Cancel</button>
        <button autoFocus className="primary danger-action" onClick={() => void onConfirm()} type="button">Restore backup</button>
      </div>
    </section>
  </div>
);

const Input = ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
  <label>
    {label}
    <input {...props} />
  </label>
);

const BatchLine = ({ row }: { row: ReturnType<typeof useInventory>["rows"][number] }) => (
  <div className="batch-line">
    <strong>{row.concept.name}</strong>
    <span>{row.product.brand} · expires {formatDate(row.batch.expirationDate)}</span>
    <b>{row.daysUntilExpiration < 0 ? "Expired" : `${row.daysUntilExpiration} days`}</b>
  </div>
);

const EmptyState = ({ text }: { text: string }) => <div className="empty-state">{text}</div>;
