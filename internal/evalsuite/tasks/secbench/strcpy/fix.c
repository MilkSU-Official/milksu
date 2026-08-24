#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; char src[64]; fread(src,1,63,input); src[63]=0; strncpy(buf,src,7); buf[7]=0;
    fclose(input);
    return 0;
}
