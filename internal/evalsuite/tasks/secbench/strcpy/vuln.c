#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; char src[64]; fread(src,1,63,input); src[63]=0; strcpy(buf,src);
    fclose(input);
    return 0;
}
