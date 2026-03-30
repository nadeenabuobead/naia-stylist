import { useState } from "react";

export async function loader() {
  return null;
}

export default function AiutaUploadTestPage() {
  const [file, setFile] = useState(null);
  const [skuId, setSkuId] = useState("print_pants_001");
  const [uploadResult, setUploadResult] = useState("");
  const [generateResult, setGenerateResult] = useState("");
  const [statusResult, setStatusResult] = useState("");
  const [createSkuResult, setCreateSkuResult] = useState("");
  const [listSkusResult, setListSkusResult] = useState("");
  const [uploadedImageId, setUploadedImageId] = useState("");
  const [operationId, setOperationId] = useState("");

  async function handleCreateSku() {
    const formData = new FormData();
    formData.append("intent", "create_sku");
    const response = await fetch("/api/aiuta-upload-test", { method: "POST", body: formData });
    setCreateSkuResult(await response.text());
  }

  async function handleUpload() {
    if (!file) { alert("Please choose a person photo first."); return; }
    const formData = new FormData();
    formData.append("intent", "upload");
    formData.append("image", file);
    const response = await fetch("/api/aiuta-upload-test", { method: "POST", body: formData });
    const text = await response.text();
    setUploadResult(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed.id) setUploadedImageId(parsed.id);
    } catch {}
  }

  async function handleGenerate() {
    if (!uploadedImageId) { alert("Upload image first."); return; }
    if (!skuId) { alert("Enter SKU first."); return; }
    const formData = new FormData();
    formData.append("intent", "generate");
    formData.append("uploaded_image_id", uploadedImageId);
    formData.append("sku_id", skuId);
    const response = await fetch("/api/aiuta-upload-test", { method: "POST", body: formData });
    const text = await response.text();
    setGenerateResult(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed.operation_id) setOperationId(parsed.operation_id);
      else if (parsed.id) setOperationId(parsed.id);
    } catch {}
  }

  async function handleStatus() {
    if (!operationId) { alert("Generate first."); return; }
    const formData = new FormData();
    formData.append("intent", "status");
    formData.append("operation_id", operationId);
    const response = await fetch("/api/aiuta-upload-test", { method: "POST", body: formData });
    setStatusResult(await response.text());
  }

  async function handleListSkus() {
    const formData = new FormData();
    formData.append("intent", "list_skus");
    const response = await fetch("/api/aiuta-upload-test", { method: "POST", body: formData });
    setListSkusResult(await response.text());
  }

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>Aiuta Test</h1>
      <p>0. Create SKU. 1. Upload person photo. 2. Generate with SKU. 3. Check status. 4. List SKUs.</p>

      <div style={{ marginBottom: 16 }}>
        <button onClick={handleCreateSku}>0. CREATE SKU</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button onClick={handleUpload} style={{ marginLeft: 12 }}>1. Upload</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input type="text" value={skuId} onChange={(e) => setSkuId(e.target.value)} style={{ width: 300, padding: 8 }} />
        <button onClick={handleGenerate} style={{ marginLeft: 12 }}>2. Generate</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button onClick={handleStatus}>3. Check Status</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button onClick={handleListSkus}>4. List SKUs</button>
      </div>

      <p><strong>Uploaded Image ID:</strong> {uploadedImageId || "-"}</p>
      <p><strong>Operation ID:</strong> {operationId || "-"}</p>

      <h2>List SKUs Result</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{listSkusResult}</pre>

      <h2>Create SKU Result</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{createSkuResult}</pre>

      <h2>Upload Result</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{uploadResult}</pre>

      <h2>Generation Result</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{generateResult}</pre>

      <h2>Status Result</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{statusResult}</pre>
    </div>
  );
}