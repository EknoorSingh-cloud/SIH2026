import { createContext, useContext, useState } from "react";

const DocumentContext = createContext();

export function DocumentProvider({ children }) {
  const [documents, setDocuments] = useState([
    {
      id: 1,
      name: "Legal_Contract.pdf",
      title: "Legal Contract",
      category: "Legal",
      type: "PDF",
      size: "2.4 MB",
      uploadedBy: "Admin",
      date: "Sep 4, 2026",
      fileUrl: null,
    },
    {
      id: 2,
      name: "Client_Agreement.pdf",
      title: "Client Agreement",
      category: "Contracts",
      type: "PDF",
      size: "1.8 MB",
      uploadedBy: "John Smith",
      date: "Sep 3, 2026",
      fileUrl: null,
    },
    {
      id: 3,
      name: "Case_Document.docx",
      title: "Case Document",
      category: "Legal",
      type: "DOCX",
      size: "856 KB",
      uploadedBy: "Admin",
      date: "Sep 2, 2026",
      fileUrl: null,
    },
    {
      id: 4,
      name: "Financial_Report.pdf",
      title: "Financial Report",
      category: "Financial",
      type: "PDF",
      size: "3.2 MB",
      uploadedBy: "Sarah Johnson",
      date: "Sep 1, 2026",
      fileUrl: null,
    },
  ]);

  const addDocument = (document) => {
    setDocuments((previousDocuments) => [
      {
        id: Date.now(),
        ...document,
      },
      ...previousDocuments,
    ]);
  };

  const deleteDocument = (id) => {
    setDocuments((previousDocuments) =>
      previousDocuments.filter(
        (document) => document.id !== id
      )
    );
  };

  return (
    <DocumentContext.Provider
      value={{
        documents,
        addDocument,
        deleteDocument,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocuments() {
  return useContext(DocumentContext);
}