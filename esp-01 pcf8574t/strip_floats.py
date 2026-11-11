Import("env")

def before_link(source, target, env):
    linkflags = env.get("LINKFLAGS", [])
    new_flags = []
    skip = False
    for i, f in enumerate(linkflags):
        if skip:
            skip = False
            continue
        if f == "-u" and i + 1 < len(linkflags) and linkflags[i + 1] in ("_printf_float", "_scanf_float"):
            skip = True
            continue
        new_flags.append(f)
    env.Replace(LINKFLAGS=new_flags)

env.AddPreAction("$BUILD_DIR/${PROGNAME}.elf", before_link)
