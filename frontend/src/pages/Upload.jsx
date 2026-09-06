import { useState } from "react";
import { useDocuments } from "../context/DocumentContext";
import Sidebar from "../components/Sidebar";
import {
  UploadCloud,
  FileText,
  X,
  CheckCircle,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

function Upload() {
  const { addDocument } = useDocuments();

  const [selectedFile, setSelectedFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Legal");
  const [customCategory, setCustomCategory] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ];

  const handleFile = (file) => {
    setError("");
    setMessage("");

    if (!file) return;

    if (!allowedTypes.includes(file.type)) {
      setError("Please upload a PDF, DOC, DOCX, or TXT file.");
      return;
    }

    setSelectedFile(file);

    // Automatically use filename as title
    if (!title) {
      const fileName = file.name.replace(/\.[^/.]+$/, "");
      setTitle(fileName);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);

    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    // Validation
    if (!selectedFile) {
      setError("Please select a document before uploading.");
      return;
    }

    if (!title.trim()) {
      setError("Please enter a document title.");
      return;
    }

    if (category === "Other" && !customCategory.trim()) {
      setError("Please specify the document category.");
      return;
    }

    // Final category
    const finalCategory =
      category === "Other"
        ? customCategory.trim()
        : category;

    // File type
    const fileType = selectedFile.name
      .split(".")
      .pop()
      .toUpperCase();

    // File size
    const fileSize =
      selectedFile.size < 1024 * 1024
        ? `${(selectedFile.size / 1024).toFixed(0)} KB`
        : `${(
            selectedFile.size /
            1024 /
            1024
          ).toFixed(2)} MB`;

    // Create new document
    const newDocument = {
      id: Date.now(),
      name: selectedFile.name,
      title: title.trim(),
      category: finalCategory,
      type: fileType,
      size: fileSize,
      uploadedBy: "Admin",
      date: new Date().toLocaleDateString(),
      fileUrl: URL.createObjectURL(selectedFile),
    };

    // Add document to context
    addDocument(newDocument);

    // Success message
    setMessage(
      `${selectedFile.name} has been uploaded successfully to the ${finalCategory} category.`
    );

    // Reset form
    setSelectedFile(null);
    setTitle("");
    setCategory("Legal");
    setCustomCategory("");
  };

  const formatFileSize = (size) => {
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">

        {/* PAGE HEADER */}
        <div className="page-header">
          <div>
            <h1>Upload Document</h1>
            <p>
              Upload and securely store important documents.
            </p>
          </div>
        </div>

        {/* SUCCESS MESSAGE */}
        {message && (
          <div className="upload-success-message">
            <CheckCircle size={20} />

            <div>
              <strong>Upload Successful</strong>
              <p>{message}</p>
            </div>

            <button
              type="button"
              onClick={() => setMessage("")}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* ERROR MESSAGE */}
        {error && (
          <div className="upload-error-message">
            <AlertCircle size={20} />

            <div>
              <strong>Upload Error</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => setError("")}
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="upload-page-grid">

          {/* UPLOAD FORM */}
          <form
            className="upload-card"
            onSubmit={handleSubmit}
          >

            {/* DROP ZONE */}
            <div
              className={`drop-zone ${
                dragActive ? "drag-active" : ""
              }`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={handleDrop}
            >

              <input
                id="file-upload"
                type="file"
                hidden
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) =>
                  handleFile(e.target.files[0])
                }
              />

              {!selectedFile ? (
                <>
                  <div className="upload-icon">
                    <UploadCloud size={36} />
                  </div>

                  <h3>
                    Drag and drop your document here
                  </h3>

                  <p>
                    or select a file from your computer
                  </p>

                  <label
                    htmlFor="file-upload"
                    className="browse-button"
                  >
                    Browse Files
                  </label>

                  <span className="supported-files">
                    Supported formats: PDF, DOC, DOCX, TXT
                  </span>
                </>
              ) : (
                <div className="selected-file">

                  <div className="selected-file-icon">
                    <FileText size={30} />
                  </div>

                  <div className="selected-file-info">
                    <h4>{selectedFile.name}</h4>

                    <p>
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="remove-file"
                    onClick={() =>
                      setSelectedFile(null)
                    }
                    title="Remove file"
                  >
                    <X size={20} />
                  </button>

                </div>
              )}
            </div>

            {/* DOCUMENT TITLE */}
            <div className="form-group">
              <label>Document Title</label>

              <input
                type="text"
                placeholder="Enter document title"
                value={title}
                onChange={(e) =>
                  setTitle(e.target.value)
                }
                required
              />
            </div>

            {/* CATEGORY */}
            <div className="form-group">
              <label>Category</label>

              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value)
                }
              >
                <option value="Legal">
                  Legal
                </option>

                <option value="Contracts">
                  Contracts
                </option>

                <option value="Financial">
                  Financial
                </option>

                <option value="Personal">
                  Personal
                </option>

                <option value="Other">
                  Other
                </option>
              </select>
            </div>

            {/* CUSTOM CATEGORY */}
            {category === "Other" && (
              <div className="form-group">
                <label>
                  Specify Category
                </label>

                <input
                  type="text"
                  placeholder="Example: Medical Records"
                  value={customCategory}
                  onChange={(e) =>
                    setCustomCategory(e.target.value)
                  }
                  required
                />
              </div>
            )}

            {/* UPLOAD BUTTON */}
            <button
              id="small-upload-button"
              type="submit"
            >
              <UploadCloud size={15} />
              Upload Securely
            </button>

          </form>

          {/* SECURITY INFORMATION */}
          <aside className="upload-info-card">

            <div className="secure-upload-icon">
              <ShieldCheck size={32} />
            </div>

            <h2>Secure Upload</h2>

            <p>
              Your documents are securely stored and protected
              using controlled access.
            </p>

            <div className="upload-info-list">

              <div>
                <CheckCircle size={18} />
                Secure Document Storage
              </div>

              <div>
                <CheckCircle size={18} />
                Protected User Access
              </div>

              <div>
                <CheckCircle size={18} />
                Easy Document Management
              </div>

            </div>

          </aside>

        </div>

      </main>
    </div>
  );
}

export default Upload;