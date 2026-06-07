# Quote Wise Client Hub — Setup Guide

## What's new in this version

### Dashboard Statistics
Four stat cards at the top of the Customers page:
- **Total Customers** — all records
- **Active Policies** — valid, more than 30 days to expiry
- **Expiring Soon** — within 30 days
- **Expired** — past expiry date

### Expiry Filters
Filter buttons: **All · 7 days · 15 days · 30 days · Expired**

### Excel / CSV Import
- "Import Excel" button next to "Add Customer"
- Accepts `.xlsx`, `.xls`, `.csv`
- Parses these column names (case-insensitive):
  - `full_name` / `Full Name` / `Name`
  - `phone` / `Phone` / `Mobile`
  - `email` / `Email`
  - `category` / `Category`
  - `insurer` / `Insurer`
  - `policy_number` / `Policy Number`
  - `vehicle_number` / `Vehicle Number`
  - `premium_amount` / `Premium`
  - `start_date` / `Start Date` (DD/MM/YYYY or YYYY-MM-DD)
  - `expiry_date` / `Expiry Date` (DD/MM/YYYY or YYYY-MM-DD)
  - `notes` / `Notes`
- Skips duplicate policy numbers automatically
- Shows imported / skipped / failed counts

### Edit Customer
- "Edit" button on the customer detail page
- Edit all fields inline
- Upload replacement KYC documents
- Saves to Supabase, refreshes list

### WhatsApp Quick Contact
- Each customer card has a WhatsApp link on the right
- Pre-filled renewal message

### Sort by Expiry
- Toggle ascending/descending sort on the list

---

## Supabase Setup

### 1. Ensure `kyc-docs` storage bucket exists
In your Supabase dashboard → Storage → Create bucket named `kyc-docs` (private).

### 2. Storage RLS policies for kyc-docs
Go to Storage → Policies → kyc-docs bucket and add:

**SELECT (read):**
```sql
(bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'))
```

**INSERT:**
```sql
(bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'))
```

**DELETE:**
```sql
(bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'))
```

### 3. Make sure nandanpernaje@gmail.com has admin role
Run in Supabase SQL Editor:
```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'nandanpernaje@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
```

---

## Vercel Deployment

In Vercel Project Settings → Build & Deployment:
- Framework: **Vite**
- Build Command: `vite build`
- Output Directory: `dist`
- Install Command: `npm install`

Environment Variables (add in Vercel):
```
VITE_SUPABASE_URL=https://kuorepiblvosmhrmeevv.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_7oYdDAkraNLDcIvCOh4Yeg_7L_SiwaU
```

---

## Sample CSV for Import

```csv
full_name,phone,email,category,insurer,policy_number,vehicle_number,premium_amount,start_date,expiry_date
Ramesh Kumar,9876543210,ramesh@email.com,Car,HDFC Ergo,POL123456,KA01AB1234,8500,01/06/2025,01/06/2026
Sunita Rao,9845001234,,Bike,ICICI Lombard,POL789012,KA04CD5678,3200,15/06/2025,15/06/2026
```
