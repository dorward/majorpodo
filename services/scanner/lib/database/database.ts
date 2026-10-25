import { Pool } from 'pg';
import configuration from '../configuration';

const pool = new Pool(configuration.database);

export default pool;
