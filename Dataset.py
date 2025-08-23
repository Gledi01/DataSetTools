import curses
import os
import sys

BASE_DIR = "./main/"

# Hex encoded credits
CREDITS_HEX = [
    "417574686f72203a20576179616e20476c65647920416c7672656e6f",
    "50726f64756374203a204461746173657420546f6f6c73",
    "56657273696f6e203a20312e30",
    "4370797269676874203a2032303235",
    "44617465203a2032332d416775737475732d323032352032323a33303a504d",
    "4f53203a204c696e7578",
    "476974687562203a20476c6564693031",
    "456d61696c203a206d6567756d696e626f74737a40676d61696c2e636f6d",
    "5768617473417070203a2036323831323431363236353833",
]

# decode Hex ke string saat runtime
def get_credits_text():
    return [bytes.fromhex(h).decode("utf-8") for h in CREDITS_HEX] + ["<Back>"]

def main(stdscr):
    curses.curs_set(0)
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_BLUE, -1)    # Folder
    curses.init_pair(2, curses.COLOR_GREEN, -1)   # File .dts
    curses.init_pair(3, curses.COLOR_YELLOW, -1)  # ../, Exit, Credits, Back
    curses.init_pair(4, curses.COLOR_CYAN, -1)    # Header
    curses.init_pair(5, curses.COLOR_MAGENTA, -1) # Credits text

    current_dir = os.path.abspath(BASE_DIR)
    selected_idx = 0
    file_content = []
    scroll_offset = 0
    monitor_scroll = 0
    credits_mode = False  

    while True:
        stdscr.clear()
        max_y, max_x = stdscr.getmaxyx()

        # Header
        stdscr.addstr(0, 2, "DATASET TOOLS", curses.color_pair(4) | curses.A_BOLD | curses.A_UNDERLINE)

        # Build entries
        entries = []
        if credits_mode:
            entries = ["<Back>"]  # khusus di mode credits
        else:
            if os.path.abspath(current_dir) != os.path.abspath(BASE_DIR):
                entries.append("../")
            for f in sorted(os.listdir(current_dir)):
                full_path = os.path.join(current_dir, f)
                if os.path.isdir(full_path):
                    entries.append(f + "/")
                elif f.endswith(".dts"):
                    entries.append(os.path.splitext(f)[0])
            entries.append("<Credits>")
            entries.append("Exit")

        # Tinggi explorer
        explorer_height = max_y // 2 - 2
        for idx, entry in enumerate(entries):
            if idx < scroll_offset:
                continue
            if idx - scroll_offset >= explorer_height:
                break

            x = 2
            y = idx - scroll_offset + 2
            attr = curses.A_NORMAL
            if idx == selected_idx:
                attr |= curses.A_REVERSE

            if entry in ["../", "Exit", "<Credits>", "<Back>"]:
                attr |= curses.color_pair(3)
            elif entry.endswith("/"):
                attr |= curses.color_pair(1)
            else:
                attr |= curses.color_pair(2)
            stdscr.addstr(y, x, entry, attr)

        # Monitor box
        monitor_start = explorer_height + 3
        stdscr.addstr(monitor_start - 1, 2, "-" * (max_x - 4))
        stdscr.addstr(monitor_start, 2, "Monitor:", curses.A_BOLD)
        monitor_height = max_y - monitor_start - 2

        # tampilkan isi monitor
        if credits_mode:
            monitor_data = get_credits_text()
        else:
            monitor_data = file_content

        for i in range(monitor_height):
            line_idx = i + monitor_scroll
            if 0 <= line_idx < len(monitor_data):
                color = curses.color_pair(5) if credits_mode else curses.A_NORMAL
                stdscr.addstr(monitor_start + 1 + i, 4, monitor_data[line_idx][:max_x-6], color)

        stdscr.refresh()

        key = stdscr.getch()

        if key == curses.KEY_UP:
            selected_idx = (selected_idx - 1) % len(entries)
            if selected_idx < scroll_offset:
                scroll_offset = selected_idx
            if not credits_mode:
                file_content = []
            monitor_scroll = 0
        elif key == curses.KEY_DOWN:
            selected_idx = (selected_idx + 1) % len(entries)
            if selected_idx - scroll_offset >= explorer_height:
                scroll_offset += 1
            if not credits_mode:
                file_content = []
            monitor_scroll = 0
        elif key == curses.KEY_NPAGE:  # PageDown
            if monitor_scroll + monitor_height < len(monitor_data):
                monitor_scroll += monitor_height
        elif key == curses.KEY_PPAGE:  # PageUp
            monitor_scroll = max(0, monitor_scroll - monitor_height)
        elif key == ord("\n"):
            choice = entries[selected_idx]
            monitor_scroll = 0
            file_content = []  

            if choice == "Exit":
                break
            elif choice == "<Credits>":
                credits_mode = True
                selected_idx = 0
            elif choice == "<Back>":
                credits_mode = False
                selected_idx = 0
            elif choice == "../":
                if os.path.abspath(current_dir) != os.path.abspath(BASE_DIR):
                    current_dir = os.path.dirname(current_dir)
                    selected_idx = 0
                    scroll_offset = 0
            else:
                full_path = os.path.join(current_dir, choice)
                if os.path.isdir(full_path):
                    current_dir = full_path
                    selected_idx = 0
                    scroll_offset = 0
                elif os.path.isfile(full_path + ".dts"):
                    try:
                        with open(full_path + ".dts", "r", encoding="utf-8") as f:
                            file_content = f.read().splitlines()
                        scroll_offset = 0
                    except Exception as e:
                        file_content = [f"[ERROR] {e}"]

        elif key == 26:  # Ctrl+Z
            sys.exit(0)

if __name__ == "__main__":
    curses.wrapper(main)