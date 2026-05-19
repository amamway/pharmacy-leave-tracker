# 💊 Pharmacy Leave Tracker

ระบบบันทึกการลาเภสัชกร — React Web App

---

## 🚀 วิธี Deploy บน Vercel (ง่ายมาก)

### ขั้นตอนที่ 1 — อัปโหลดขึ้น GitHub

1. ไปที่ [github.com](https://github.com) → สร้าง account ถ้ายังไม่มี
2. กด **New repository** → ตั้งชื่อ `pharmacy-leave-tracker`
3. เลือก **Public** → กด **Create repository**
4. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น GitHub

> 💡 ถ้าใช้ GitHub Desktop (ง่ายกว่า):
> - ดาวน์โหลด [GitHub Desktop](https://desktop.github.com)
> - File → Add Local Repository → เลือกโฟลเดอร์นี้
> - กด Publish repository

### ขั้นตอนที่ 2 — Deploy บน Vercel

1. ไปที่ [vercel.com](https://vercel.com) → **Sign up with GitHub**
2. กด **Add New Project**
3. เลือก repository `pharmacy-leave-tracker`
4. กด **Deploy** → รอ ~1 นาที
5. ได้ลิงก์เว็บแชร์ได้เลย! 🎉

---

## 💻 รันในเครื่องก่อน (ถ้าต้องการทดสอบ)

ต้องมี [Node.js](https://nodejs.org) ก่อน จากนั้น:

```bash
npm install
npm start
```

เปิดที่ http://localhost:3000

---

## 🔑 บัญชีผู้ใช้

| Username | Password | สิทธิ์ |
|----------|----------|--------|
| admin    | 0000     | แก้ไขได้ทุกอย่าง |
| member   | 1234     | ดูอย่างเดียว |

---

## ⚠️ หมายเหตุสำคัญ

ข้อมูลการลาจะ **หายทุกครั้งที่รีโหลดหน้าเว็บ** เพราะเก็บใน memory  
ถ้าต้องการให้ข้อมูลอยู่ถาวร ต้องเพิ่ม database เช่น Firebase หรือ Supabase
