import express from 'express';
import generateReport from '../api/reportController.js';

const router = express.Router();

router.post("/report", generateReport);

router.post("/", generateReport);

export default router;

