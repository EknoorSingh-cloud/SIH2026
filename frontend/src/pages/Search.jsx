import { useState } from "react";
import Sidebar from "../components/Sidebar";
import {
  Search as SearchIcon,
  FileText,
  Calendar,
  User,
  Folder,
  X,
  Eye,
} from "lucide-react";

function Search() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedDocument, setSelectedDocument] = useState(null);

  const documents = [
    {
      id: 1,
      name: "Legal_Contract.pdf",
      category: "Legal",
      type: "PDF Document",
      uploadedBy: "Admin",
      date: "Sep 4, 2026",
    },
    {
      id: 2,
      name: "Client_Agreement.pdf",
      category: "Contracts",
      type: "PDF Document",
      uploadedBy: "John Smith",
      date: "Sep 3, 2026",
    },
    {
      id: 3,
      name: "Financial_Report.pdf",
      category: "Financial",
      type: "PDF Document",
      uploadedBy: "Admin",
      date: "Sep 2, 2026",
    },
    {
      id: 4,
      name: "Personal_Identity.docx",
      category: "Personal",
      type: "Word Document",
      uploadedBy: "Sarah Johnson",
      date: "Sep 1, 2026",
    },
  ];

  const categories = [
    "All",
    "Legal",
    "Contracts",
    "Financial",
    "Personal",
  ];

  const filteredDocuments = documents.filter((document) => {
    const search = searchTerm.toLowerCase();

    const matchesSearch =
      document.name.toLowerCase().includes(search) ||
      document.category.toLowerCase().includes(search);

    const matchesCategory =
      selectedCategory === "All" ||
      document.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const clearSearch = () => {
    setSearchTerm("");
    setSelectedCategory("All");
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        {/* HEADER */}

        <div className="page-header">
          <div>
            <h1>Search Documents</h1>

            <p>
              Quickly find documents across your secure storage.
            </p>
          </div>
        </div>

        {/* SEARCH CARD */}

        <div className="search-page-card">
          <div className="large-search-box">
            <SearchIcon size={22} />

            <input
              type="text"
              placeholder="Search by document name or category..."
              value={searchTerm}
              onChange={(e) =>
                setSearchTerm(e.target.value)
              }
            />

            {searchTerm && (
              <button
                className="clear-search"
                type="button"
                onClick={() => setSearchTerm("")}
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* CATEGORY FILTERS */}

          <div className="category-filters">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={
                  selectedCategory === category
                    ? "category-button active-category"
                    : "category-button"
                }
                onClick={() =>
                  setSelectedCategory(category)
                }
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* RESULTS HEADER */}

        <div className="search-results-header">
          <div>
            <h2>
              {filteredDocuments.length} Document
              {filteredDocuments.length !== 1
                ? "s"
                : ""}{" "}
              Found
            </h2>

            {(searchTerm ||
              selectedCategory !== "All") && (
              <p className="search-active-info">
                Filters are currently active
              </p>
            )}
          </div>

          {(searchTerm ||
            selectedCategory !== "All") && (
            <button
              className="clear-all-button"
              type="button"
              onClick={clearSearch}
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* RESULTS */}

        {filteredDocuments.length > 0 && (
          <div className="search-results-grid">
            {filteredDocuments.map((document) => (
              <div
                className="search-document-card"
                key={document.id}
              >
                <div className="search-document-top">
                  <div className="search-file-icon">
                    <FileText size={25} />
                  </div>

                  <span className="search-category">
                    {document.category}
                  </span>
                </div>

                <h3>{document.name}</h3>

                <p className="document-type">
                  {document.type}
                </p>

                <div className="search-document-info">
                  <div>
                    <User size={15} />
                    <span>{document.uploadedBy}</span>
                  </div>

                  <div>
                    <Calendar size={15} />
                    <span>{document.date}</span>
                  </div>
                </div>

                <button
                  className="view-document-button"
                  type="button"
                  onClick={() =>
                    setSelectedDocument(document)
                  }
                >
                  <Eye size={17} />
                  View Document
                </button>
              </div>
            ))}
          </div>
        )}

        {/* EMPTY STATE */}

        {filteredDocuments.length === 0 && (
          <div className="search-empty-state">
            <SearchIcon size={55} />

            <h2>No documents found</h2>

            <p>
              Try changing your search or category filter.
            </p>

            <button
              className="primary-button"
              type="button"
              onClick={clearSearch}
            >
              Clear Filters
            </button>
          </div>
        )}

        {/* DOCUMENT PREVIEW MODAL */}

        {selectedDocument && (
          <div className="modal-overlay">
            <div className="search-preview-modal">
              <button
                className="modal-close-button"
                type="button"
                onClick={() =>
                  setSelectedDocument(null)
                }
              >
                <X size={20} />
              </button>

              <div className="preview-file-icon">
                <FileText size={45} />
              </div>

              <h2>{selectedDocument.name}</h2>

              <span className="search-category preview-category">
                {selectedDocument.category}
              </span>

              <div className="document-details">
                <div>
                  <span>Document Type</span>
                  <strong>
                    {selectedDocument.type}
                  </strong>
                </div>

                <div>
                  <span>Category</span>
                  <strong>
                    {selectedDocument.category}
                  </strong>
                </div>

                <div>
                  <span>Uploaded By</span>
                  <strong>
                    {selectedDocument.uploadedBy}
                  </strong>
                </div>

                <div>
                  <span>Upload Date</span>
                  <strong>
                    {selectedDocument.date}
                  </strong>
                </div>
              </div>

              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  setSelectedDocument(null)
                }
              >
                Close Preview
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Search;