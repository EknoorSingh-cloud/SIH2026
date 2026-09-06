import { useState } from "react";
import Sidebar from "../components/Sidebar";
import {
  FileText,
  Search,
  Download,
  Trash2,
  Eye,
  MoreVertical,
  Filter,
} from "lucide-react";

function Documents() {
  const [searchTerm, setSearchTerm] = useState("");

  const documents = [
    {
      id: 1,
      name: "Legal_Contract.pdf",
      type: "PDF",
      size: "2.4 MB",
      uploadedBy: "Admin",
      date: "Sep 4, 2026",
    },
    {
      id: 2,
      name: "Client_Agreement.pdf",
      type: "PDF",
      size: "1.8 MB",
      uploadedBy: "John Smith",
      date: "Sep 3, 2026",
    },
    {
      id: 3,
      name: "Case_Document.docx",
      type: "DOCX",
      size: "856 KB",
      uploadedBy: "Admin",
      date: "Sep 2, 2026",
    },
    {
      id: 4,
      name: "Financial_Report.pdf",
      type: "PDF",
      size: "3.2 MB",
      uploadedBy: "Sarah Johnson",
      date: "Sep 1, 2026",
    },
  ];

  const filteredDocuments = documents.filter((document) =>
    document.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <div className="page-header">
          <div>
            <h1>Documents</h1>
            <p>Manage and access all your secure documents.</p>
          </div>

          <button className="primary-button">
            + Upload Document
          </button>
        </div>

        <div className="documents-toolbar">
          <div className="search-box">
            <Search size={20} />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <button className="filter-button">
            <Filter size={18} />
            Filter
          </button>
        </div>

        <div className="documents-table-container">
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
                  <td>
                    <div className="table-document">
                      <div className="file-icon">
                        <FileText size={20} />
                      </div>

                      <span>{document.name}</span>
                    </div>
                  </td>

                  <td>
                    <span className="document-badge">
                      {document.type}
                    </span>
                  </td>

                  <td>{document.size}</td>

                  <td>{document.uploadedBy}</td>

                  <td>{document.date}</td>

                  <td>
                    <div className="action-buttons">
                      <button title="View">
                        <Eye size={18} />
                      </button>

                      <button title="Download">
                        <Download size={18} />
                      </button>

                      <button
                        className="delete-button"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredDocuments.length === 0 && (
            <div className="empty-state">
              <FileText size={45} />
              <h3>No documents found</h3>
              <p>Try searching for something else.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default Documents;