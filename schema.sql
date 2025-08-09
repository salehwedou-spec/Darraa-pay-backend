CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT,
  total_amount NUMERIC(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id) ON DELETE SET NULL,
  provider VARCHAR(50),
  provider_ref VARCHAR(100) UNIQUE,
  amount NUMERIC(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  provider_payload JSONB,
  created_at TIMESTAMP DEFAULT now()
);
