# Dataset Tools - Official

**Dataset Tools** adalah aplikasi terminal berbasis Python dan `curses` untuk mengelola dataset resmi (`.dts`) dengan tampilan interaktif. Aplikasi ini memungkinkan navigasi folder, melihat isi file dataset, dan menampilkan informasi secara real-time melalui monitor interaktif.  

---

## Fitur Utama

1. **Navigasi Folder Interaktif**
   - Menampilkan semua folder di `./main/`.
   - Folder yang dapat dibuka diberi tanda `/`.
   - File dataset `.dts` ditampilkan tanpa ekstensi.
   - Kembali ke parent folder tersedia melalui `../`, hanya muncul di subfolder.

2. **Monitor Isi File**
   - Monitor interaktif menampilkan isi file saat dipilih.
   - Scrollable menggunakan `PageUp/PageDown` untuk file panjang.
   - Otomatis clear saat berpindah ke file/folder lain.

3. **Informasi Credits**
   - Pilihan `<Credits>` menampilkan:
     ```
     Author    : Wayan Gledy Alvreno
     Product   : Dataset Tools
     Version   : 1.0
     Copyright : 2025
     Date      : 23-Agustus-2025 22:30PM
     OS        : Linux
     Github    : Gledi01
     Email     : meguminbotsz@gmail.com
     WhatsApp  : 6281241462583
     ```
   - `<Back>` untuk kembali ke navigasi utama.

4. **Navigasi dan Shortcut**
   | Shortcut       | Fungsi                                         |
   |----------------|-----------------------------------------------|
   | Arrow Up/Down  | Pindah pilihan file/folder                     |
   | Enter          | Masuk folder / lihat isi file `.dts`         |
   | PageUp/PageDown| Scroll isi monitor                            |
   | Ctrl+Z         | Keluar dari aplikasi                           |

5. **File Filtering**
   - Hanya menampilkan file dengan ekstensi `.dts`.
   - Nama file ditampilkan tanpa ekstensi.
   - Folder dan file diberikan pewarnaan berbeda.

---

## Cara menambahkan dataset

```bash
nano <nama dataset yang kamu inginkan>.dts
```
setelah itu save dan buka tools nya
---

## Instalasi

### Persiapan (Termux/Linux)

```bash
# Clone repository
git clone https://github.com/Gledi01/DataSetTools
cd DataSetTools

# jalankan Setup.sh
bash setup.sh

# Jalankan aplikasi
python3 main.py
