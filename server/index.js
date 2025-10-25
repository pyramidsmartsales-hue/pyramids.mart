import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import customersRouter from './routes/customers.js';
import sendRouter from './routes/send.js';


dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());


app.use('/api/customers', customersRouter);
app.use('/api/send', sendRouter);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));