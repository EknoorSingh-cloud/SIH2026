import { useState } from "react";
import Sidebar from "../components/Sidebar";
import { UploadCloud, FileText, X, CheckCircle } from "lucide-react";

function Upload() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Legal");
  const [customCategory, setCustomCategory] = useState("");

  const handleFile = (file) => {
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedFile) {
      alert("Please select a document first.");
      return;
    }

    const finalCategory =
  category === "Other" ? customCategory : category;

alert(
  `${selectedFile.name} uploaded successfully!\nCategory: ${finalCategory}`
);

    setSelectedFile(null);
    setTitle("");
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <div className="page-header">
          <div>
            <h1>Upload Document</h1>
            <p>Upload and securely store your important documents.</p>
          </div>
        </div>

        <div className="upload-page-grid">
          <form className="upload-card" onSubmit={handleSubmit}>
            <div
              className={`drop-zone ${dragActive ? "drag-active" : ""}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                id="file-upload"
                type="file"
                hidden
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => handleFile(e.target.files[0])}
              />

              {!selectedFile ? (
                <>
                  <div className="upload-icon">
                    <UploadCloud size={35} />
                  </div>

                  <h3>Drag & drop your document here</h3>

                  <p>or</p>

                  <label htmlFor="file-upload" className="browse-button">
                    Browse Files
                  </label>

                  <span>Supported: PDF, DOC, DOCX, TXT</span>
                </>
              ) : (
                <div className="selected-file">
                  <div className="selected-file-icon">
                    <FileText size={30} />
                  </div>

                  <div className="selected-file-info">
                    <h4>{selectedFile.name}</h4>
                    <p>
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>

                  <button
                    type="button"
                    className="remove-file"
                    onClick={() => setSelectedFile(null)}
                  >
                    <X size={20} />
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Document Title</label>

              <input
                type="text"
                placeholder="Enter document title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
  <label>Category</label>

  <select
    value={category}
    onChange={(e) => setCategory(e.target.value)}
  >
    <option value="Legal">Legal</option>
    <option value="Contracts">Contracts</option>
    <option value="Financial">Financial</option>
    <option value="Personal">Personal</option>
    <option value="Other">Other</option>
  </select>
</div>

{category === "Other" && (
  <div className="form-group">
    <label>Specify Category</label>

    <input
      type="text"
      placeholder="Enter your category"
      value={customCategory}
      onChange={(e) => setCustomCategory(e.target.value)}
      required
    />
  </div>
)}

            <button type="submit" className="primary-button upload-submit">
              <UploadCloud size={18} />
              Upload Securely
            </button>
          </form>

          <div className="upload-info-card">
            <CheckCircle size={30} />

            <h2>Secure Upload</h2>

            <p>
              Your documents are securely stored and protected using
              access controls.
            </p>

            <div className="upload-info-list">
              <div>🔐 Secure Storage</div>
              <div>🛡️ Access Control</div>
              <div>📁 Easy Management</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Upload;