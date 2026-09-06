const express = require("express");
const multer = require("multer");

const { requireAuth } = require("../middleware/auth");
const { processWithOCR } = require("../services/ocr");

const router = express.Router();


// ----------------------------------------------------
// MULTER CONFIGURATION
//
// Files are temporarily stored in memory and sent
// directly to the Python OCR service.
// ----------------------------------------------------

const storage = multer.memoryStorage();

const upload = multer({
    storage,

    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
    },

    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            "image/jpeg",
            "image/jpg",
            "image/png",
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return cb(
                new Error(
                    "Only JPG and PNG images are allowed."
                )
            );
        }

        cb(null, true);
    },
});


// ----------------------------------------------------
// POST /api/v1/documents/upload
//
// Flow:
//
// User
//   ↓
// Node.js Backend
//   ↓
// Python OCR Service
//   ↓
// Return OCR Result
// ----------------------------------------------------

router.post(
    "/upload",

    requireAuth,

    upload.single("file"),

    async (req, res, next) => {
        try {

            if (!req.file) {
                return res.status(400).json({
                    error: "no_file",
                    message: "Please upload a document.",
                });
            }


            // Send document to Python OCR service
            const ocrResult = await processWithOCR(req.file);


            // Return complete OCR result
            return res.status(200).json({

                message: "Document processed successfully.",

                uploaded_by: {
                    id: req.user.id,
                    service_number: req.user.service_number,
                    name: req.user.name,
                },

                original_file: {
                    filename: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                },

                ocr_result: ocrResult,
            });

        } catch (error) {
            next(error);
        }
    }
);


module.exports = router;