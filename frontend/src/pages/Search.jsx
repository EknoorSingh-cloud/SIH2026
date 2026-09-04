import { useState } from "react";
import Sidebar from "../components/Sidebar";
import {
  Search as SearchIcon,
  FileText,
  Calendar,
  User,
  Folder,
  X,
} from "lucide-react";

function Search() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

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

  const filteredDocuments = documents.filter((document) => {
    const matchesSearch = document.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());

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
        <div className="page-header">
          <div>
            <h1>Search Documents</h1>
            <p>Quickly find documents across your secure storage.</p>
          </div>
        </div>

        <div className="search-page-card">
          <div className="large-search-box">
            <SearchIcon size={22} />

            <input
              type="text"
              placeholder="Search by document name..."
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

          <div className="category-filters">
            {["All", "Legal", "Contracts", "Financial", "Personal"].map(
              (category) => (
                <button
                  key={category}
                  className={
                    selectedCategory === category
                      ? "category-button active-category"
                      : "category-button"
                  }
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              )
            )}
          </div>
        </div>

        <div className="search-results-header">
          <h2>
            {filteredDocuments.length} Document
            {filteredDocuments.length !== 1 ? "s" : ""} Found
          </h2>

          {(searchTerm || selectedCategory !== "All") && (
            <button className="clear-all-button" onClick={clearSearch}>
              Clear Filters
            </button>
          )}
        </div>

        <div className="search-results-grid">
          {filteredDocuments.map((document) => (
            <div className="search-document-card" key={document.id}>
              <div className="search-document-top">
                <div className="search-file-icon">
                  <FileText size={25} />
                </div>

                <span className="search-category">
                  {document.category}
                </span>
              </div>

              <h3>{document.name}</h3>

              <p className="document-type">{document.type}</p>

              <div className="search-document-info">
                <div>
                  <User size={15} />
                  {document.uploadedBy}
                </div>

                <div>
                  <Calendar size={15} />
                  {document.date}
                </div>
              </div>

              <button className="view-document-button">
                <Folder size={17} />
                View Document
              </button>
            </div>
          ))}
        </div>

        {filteredDocuments.length === 0 && (
          <div className="search-empty-state">
            <SearchIcon size={55} />
            <h2>No documents found</h2>
            <p>Try changing your search or category filter.</p>

            <button className="primary-button" onClick={clearSearch}>
              Clear Filters
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default Search;