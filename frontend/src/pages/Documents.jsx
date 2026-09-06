import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useDocuments } from "../context/DocumentContext";

import {
  FileText,
  Search,
  Download,
  Trash2,
  Eye,
  Filter,
  Upload,
  X,
} from "lucide-react";

function Documents() {
  const navigate = useNavigate();

  // Documents from Context
  const { documents, deleteDocument } = useDocuments();

  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState(null);

  // Search documents
  const filteredDocuments = documents.filter((document) =>
    document.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  // Open delete modal
  const handleDeleteClick = (document) => {
    setDocumentToDelete(document);
    setShowDeleteModal(true);
  };

  // Confirm delete
  const confirmDelete = () => {
    if (!documentToDelete) return;

    deleteDocument(documentToDelete.id);

    setShowDeleteModal(false);
    setDocumentToDelete(null);
  };

  // Cancel delete
  const cancelDelete = () => {
    setShowDeleteModal(false);
    setDocumentToDelete(null);
  };

  // Download document
  const handleDownload = (document) => {
    if (!document.fileUrl) {
      alert("Download is not available for this document.");
      return;
    }

    const link = document.createElement("a");
    link.href = document.fileUrl;
    link.download = document.name;
    link.click();
  };

  // View document
  const handleView = (document) => {
    if (!document.fileUrl) {
      alert("Preview is not available for this document.");
      return;
    }

    window.open(document.fileUrl, "_blank");
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">

        {/* PAGE HEADER */}
        <div className="page-header">
          <div>
            <h1>Documents</h1>
            <p>Manage and access all your secure documents.</p>
          </div>

          <button
            className="primary-button"
            onClick={() => navigate("/upload")}
          >
            <Upload size={18} />
            Upload Document
          </button>
        </div>

        {/* TOOLBAR */}
        <div className="documents-toolbar">

          <div className="search-box">
            <Search size={20} />

            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {searchTerm && (
              <button
                className="clear-search"
                onClick={() => setSearchTerm("")}
              >
                <X size={18} />
              </button>
            )}
          </div>

          <button className="filter-button">
            <Filter size={18} />
            Filter
          </button>

        </div>

        {/* DOCUMENT TABLE */}
        <div className="documents-table-container">

          {filteredDocuments.length > 0 ? (
            <table className="documents-table">

              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Uploaded By</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                {filteredDocuments.map((document) => (

                  <tr key={document.id}>

                    {/* DOCUMENT */}
                    <td>
                      <div className="table-document">

                        <div className="file-icon">
                          <FileText size={20} />
                        </div>

                        <span>
                          {document.name}
                        </span>

                      </div>
                    </td>

                    {/* TYPE */}
                    <td>
                      <span className="document-badge">
                        {document.type || "FILE"}
                      </span>
                    </td>

                    {/* SIZE */}
                    <td>
                      {document.size || "—"}
                    </td>

                    {/* UPLOADED BY */}
                    <td>
                      {document.uploadedBy || "Admin"}
                    </td>

                    {/* DATE */}
                    <td>
                      {document.date || "Today"}
                    </td>

                    {/* ACTIONS */}
                    <td>

                      <div className="action-buttons">

                        {/* VIEW */}
                        <button
                          title="View Document"
                          onClick={() => handleView(document)}
                        >
                          <Eye size={18} />
                        </button>

                        {/* DOWNLOAD */}
                        <button
                          title="Download Document"
                          onClick={() => handleDownload(document)}
                        >
                          <Download size={18} />
                        </button>

                        {/* DELETE */}
                        <button
                          className="delete-button"
                          title="Delete Document"
                          onClick={() =>
                            handleDeleteClick(document)
                          }
                        >
                          <Trash2 size={18} />
                        </button>

                      </div>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>
          ) : (

            /* EMPTY STATE */
            <div className="empty-state">

              <FileText size={50} />

              <h3>No documents found</h3>

              <p>
                {searchTerm
                  ? "Try searching for something else."
                  : "Upload your first document to get started."}
              </p>

              {!searchTerm && (
                <button
                  className="primary-button"
                  onClick={() => navigate("/upload")}
                >
                  <Upload size={18} />
                  Upload Document
                </button>
              )}

            </div>

          )}

        </div>

        {/* DELETE MODAL */}
        {showDeleteModal && documentToDelete && (

          <div className="modal-overlay">

            <div className="delete-modal">

              <div className="delete-icon">
                <Trash2 size={32} />
              </div>

              <h2>Delete Document?</h2>

              <p>
                Are you sure you want to delete
                <strong>
                  {" "}
                  {documentToDelete.name}
                </strong>
                ?
              </p>

              <p className="delete-warning">
                This action cannot be undone.
              </p>

              <div className="delete-modal-actions">

                <button
                  className="cancel-button"
                  onClick={cancelDelete}
                >
                  Cancel
                </button>

                <button
                  className="confirm-delete-button"
                  onClick={confirmDelete}
                >
                  Delete Document
                </button>

              </div>

            </div>

          </div>

        )}

      </main>
    </div>
  );
}

export default Documents;