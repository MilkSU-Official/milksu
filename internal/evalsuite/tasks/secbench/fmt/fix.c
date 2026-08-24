#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[64]; fread(buf,1,63,input); buf[63]=0; printf("%s", buf);
    fclose(input);
    return 0;
}
